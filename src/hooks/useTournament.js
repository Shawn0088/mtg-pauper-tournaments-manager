import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { swissPair, calcStandings, getWeekStart } from '../swiss'

export function useTournament() {
  const [tournaments, setTournaments] = useState([])
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { loadTournaments() }, [])

  const loadTournaments = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tournaments')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) console.error('loadTournaments:', error)
    setTournaments(data || [])
    setLoading(false)
  }

  const createTournament = async (name) => {
    const date = new Date().toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('tournaments')
      .insert({ name, date })
      .select().single()
    if (error) { console.error('createTournament:', error); return null }
    setTournaments(prev => [data, ...prev])
    setActive(data.id)
    return data
  }

  const addEntry = async (tournamentId, playerName, deck) => {
    const { error } = await supabase
      .from('entries')
      .insert({ tournament_id: tournamentId, player_name: playerName, deck })
    if (error) console.error('addEntry:', error)
  }

  const removeEntry = async (tournamentId, playerName) => {
    const { error } = await supabase
      .from('entries')
      .delete()
      .eq('tournament_id', tournamentId)
      .eq('player_name', playerName)
    if (error) console.error('removeEntry:', error)
  }

  const getEntries = async (tournamentId) => {
    const { data, error } = await supabase.from('entries').select('*').eq('tournament_id', tournamentId)
    if (error) console.error('getEntries:', error)
    return data || []
  }

  const getResults = async (tournamentId) => {
    const { data, error } = await supabase.from('results').select('*').eq('tournament_id', tournamentId)
    if (error) console.error('getResults:', error)
    return data || []
  }

  const startRound = async (tournamentId) => {
    const entries = await getEntries(tournamentId)
    const results = await getResults(tournamentId)
    const t = tournaments.find(x => x.id === tournamentId)
    const roundNum = (t?.rounds || 0) + 1
    const players = entries.map(e => e.player_name)
    const pairings = swissPair(players, results, roundNum)

    const { error } = await supabase
      .from('results')
      .insert(pairings.map(p => ({ tournament_id: tournamentId, ...p })))
    if (error) console.error('startRound insert:', error)

    const { error: error2 } = await supabase
      .from('tournaments')
      .update({ rounds: roundNum })
      .eq('id', tournamentId)
    if (error2) console.error('startRound update:', error2)

    setTournaments(prev => prev.map(x => x.id === tournamentId ? { ...x, rounds: roundNum } : x))
  }

  const submitResult = async (resultId, s1, s2) => {
    const { error } = await supabase.from('results').update({ s1, s2 }).eq('id', resultId)
    if (error) console.error('submitResult:', error)
  }

  const rewindToRound = async (tournamentId, roundNum) => {
  // elimina tutti i round successivi
  const { error } = await supabase
    .from('results')
    .delete()
    .eq('tournament_id', tournamentId)
    .gt('round', roundNum)
  if (error) console.error('rewindToRound delete results:', error)

  // riapre il torneo e riporta il contatore round indietro
  const { error: error2 } = await supabase
    .from('tournaments')
    .update({ rounds: roundNum, finished: false })
    .eq('id', tournamentId)
  if (error2) console.error('rewindToRound update tournament:', error2)

  // rimuove eventuali punteggi già registrati in classifica per questo torneo
  await supabase.from('leaderboard').delete().eq('tournament_id', tournamentId)

  setTournaments(prev => prev.map(x => x.id === tournamentId ? { ...x, rounds: roundNum, finished: false } : x))
  }

  const deleteTournament = async (tournamentId) => {
  const { error } = await supabase.from('tournaments').delete().eq('id', tournamentId)
  if (error) { console.error('deleteTournament:', error); return false }
  setTournaments(prev => prev.filter(x => x.id !== tournamentId))
  if (active === tournamentId) setActive(null)
  return true
  }

  const updateEntryDeck = async (tournamentId, playerName, deck) => {
  const { error } = await supabase
    .from('entries')
    .update({ deck })
    .eq('tournament_id', tournamentId)
    .eq('player_name', playerName)
  if (error) console.error('updateEntryDeck:', error)
}

  const finishTournament = async (tournamentId) => {
  const entries = await getEntries(tournamentId)
  const results = await getResults(tournamentId)
  const players = entries.map(e => e.player_name)
  const standings = calcStandings(players, results)
  const t = tournaments.find(x => x.id === tournamentId)
  const weekStart = getWeekStart(t.date)

  // rimuove righe precedenti di questo torneo (in caso di "Modifica" e re-salvataggio)
  await supabase.from('leaderboard').delete().eq('tournament_id', tournamentId)

  const rows = standings.map(p => {
    const entry = entries.find(e => e.player_name === p.name)
    return {
      player_name: p.name, week_start: weekStart,
      pts: p.pts, wins: p.wins, losses: p.losses, draws: p.draws,
      deck: entry?.deck || 'Unknown', tournament_id: tournamentId
    }
  })
  const { error } = await supabase.from('leaderboard').insert(rows)
  if (error) console.error('finishTournament insert leaderboard:', error)

  const { error: error2 } = await supabase.from('tournaments').update({ finished: true }).eq('id', tournamentId)
  if (error2) console.error('finishTournament update:', error2)
  setTournaments(prev => prev.map(x => x.id === tournamentId ? { ...x, finished: true } : x))
  }

  const swapPlayers = async (resultIdA, fieldA, resultIdB, fieldB, nameA, nameB) => {
  await supabase.from('results').update({ [fieldA]: nameB }).eq('id', resultIdA)
  await supabase.from('results').update({ [fieldB]: nameA }).eq('id', resultIdB)
  }


  const renamePlayer = async (tournamentId, oldName, newName) => {
  await supabase.from('entries').update({ player_name: newName })
    .eq('tournament_id', tournamentId).eq('player_name', oldName)

  await supabase.from('results').update({ p1: newName })
    .eq('tournament_id', tournamentId).eq('p1', oldName)

  await supabase.from('results').update({ p2: newName })
    .eq('tournament_id', tournamentId).eq('p2', oldName)

  await supabase.from('leaderboard').update({ player_name: newName })
    .eq('tournament_id', tournamentId).eq('player_name', oldName)
  }

  return {
    tournaments, active, setActive, loading,
    createTournament, addEntry, removeEntry, updateEntryDeck,
    getEntries, getResults, startRound, submitResult, finishTournament,
    rewindToRound, deleteTournament, swapPlayers, renamePlayer, reload: loadTournaments
  }
}