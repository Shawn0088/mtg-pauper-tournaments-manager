import { useState, useEffect } from 'react'
import { useTimer } from './hooks/useTimer'
import { useTournament } from './hooks/useTournament'
import { calcStandings, getWeekStart } from './swiss'
import { supabase } from './supabase'
import { Bar } from 'react-chartjs-2'
import { Chart as ChartJS, CategoryScale, LinearScale, BarElement, Tooltip } from 'chart.js'
import { DndContext, useDraggable, useDroppable, PointerSensor, TouchSensor, useSensor, useSensors } from '@dnd-kit/core'
ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip)

// ---- UTILS ----
const fmt = s => {
  const sign = s < 0 ? '-' : ''
  const abs = Math.abs(s)
  const m = String(Math.floor(abs / 60)).padStart(2, '0')
  const sc = String(abs % 60).padStart(2, '0')
  return `${sign}${m}:${sc}`
}

const PASSWORD = import.meta.env.VITE_ADMIN_PASSWORD || 'changeme' 

export default function App() {
  const [tab, setTab] = useState('tournament')
  const [hash, setHash] = useState(window.location.hash)
  const [authed, setAuthed] = useState(() => sessionStorage.getItem('mtg_auth') === 'true')
  const [pwInput, setPwInput] = useState('')
  const [pwError, setPwError] = useState(false)

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (hash === '#/play') return <PlayerView />

  if (!authed) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f5f5', fontFamily: 'system-ui' }}>
      <div style={{ background: 'white', borderRadius: 16, border: '0.5px solid #e0e0e0', padding: 32, width: '100%', maxWidth: 360 }}>
        <div style={{ fontSize: 24, marginBottom: 4 }}>🛡️</div>
        <div style={{ fontSize: 18, fontWeight: 500, marginBottom: 4 }}>MTG Pauper</div>
        <div style={{ fontSize: 13, color: '#666', marginBottom: 24 }}>Area riservata — inserisci la password per accedere.</div>
        <input
          type="password"
          placeholder="Password"
          value={pwInput}
          onChange={e => { setPwInput(e.target.value); setPwError(false) }}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              if (pwInput === PASSWORD) {
                sessionStorage.setItem('mtg_auth', 'true')
                setAuthed(true)
              } else {
                setPwError(true)
                setPwInput('')
              }
            }
          }}
          autoFocus
          style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: `0.5px solid ${pwError ? '#E24B4A' : '#ccc'}`, fontSize: 15, marginBottom: 8, boxSizing: 'border-box' }}
        />
        {pwError && <div style={{ fontSize: 12, color: '#E24B4A', marginBottom: 8 }}>Password errata.</div>}
        <button
          onClick={() => {
            if (pwInput === PASSWORD) {
              sessionStorage.setItem('mtg_auth', 'true')
              setAuthed(true)
            } else {
              setPwError(true)
              setPwInput('')
            }
          }}
          style={{ width: '100%', padding: '10px', borderRadius: 8, border: 'none', background: '#3C3489', color: 'white', fontSize: 14, fontWeight: 500, cursor: 'pointer' }}>
          Accedi
        </button>
      </div>
    </div>
  )

  const tabs = [
    { id: 'tournament', label: 'Torneo', icon: '⚔️' },
    { id: 'timer',      label: 'Timer',  icon: '⏱️' },
    { id: 'standings',  label: 'Rank',   icon: '🏆' },
    { id: 'database',   label: 'Stats',  icon: '📊' },
  ]

  return (
    <div style={{ maxWidth: 700, margin: '0 auto', padding: 12, fontFamily: 'system-ui' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>
          🛡️ MTG Pauper — Gestore Tornei
        </h2>
        <button onClick={() => { sessionStorage.removeItem('mtg_auth'); setAuthed(false) }}
          style={{ border: 'none', background: 'none', fontSize: 12, color: '#999', cursor: 'pointer' }}>
          Esci
        </button>
      </div>
      <nav style={{ display: 'flex', gap: 6, marginBottom: 16, background: 'white',
        borderRadius: 12, padding: 6, border: '0.5px solid #e0e0e0' }}>
        {tabs.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ flex: 1, padding: '8px 4px', border: 'none', borderRadius: 8,
              fontSize: 12, fontWeight: 500, cursor: 'pointer',
              background: tab === t.id ? '#f0f0f0' : 'none',
              color: tab === t.id ? '#1a1a1a' : '#666' }}>
            {t.icon}<br />{t.label}
          </button>
        ))}
      </nav>

      {tab === 'tournament' && <TournamentTab />}
      {tab === 'timer'      && <TimerTab />}
      {tab === 'standings'  && <StandingsTab />}
      {tab === 'database'   && <DatabaseTab />}
    </div>
  )
}

// ---- TOURNAMENT ----
function TournamentTab() {
  const { tournaments, active, setActive, loading,
    createTournament, addEntry, removeEntry, updateEntryDeck,
    getEntries, getResults, startRound, submitResult,
    finishTournament, rewindToRound, deleteTournament, renamePlayer, swapPlayers } = useTournament()

  const [newName, setNewName] = useState('')
  const [playerInput, setPlayerInput] = useState('')
  const [deckInput, setDeckInput] = useState('')   
  const [entries, setEntries] = useState([])
  const [results, setResults] = useState([])
  const [activeTournament, setActiveTournament] = useState(null)
  const [editMode, setEditMode] = useState(true)
  const [deckInputs, setDeckInputs] = useState({})
  const [renamingPlayer, setRenamingPlayer] = useState(null)
  const [renamePlayerValue, setRenamePlayerValue] = useState('')
  const [dragEnabled, setDragEnabled] = useState(false)
  const startRenamePlayer = (name) => { setRenamingPlayer(name); setRenamePlayerValue(name) }

  const confirmRenamePlayer = async () => {
    if (!renamingPlayer) return
    const oldName = renamingPlayer
    const newName = renamePlayerValue.trim()
    if (!newName || newName === oldName) { setRenamingPlayer(null); return }
    if (entries.some(e => e.player_name === newName)) {
      alert('Esiste già un giocatore con questo nome in questo torneo.')
      setRenamingPlayer(null); return
    }
    await renamePlayer(active, oldName, newName)
    setRenamingPlayer(null)
    setDeckInputs(prev => {
      const next = { ...prev }
      if (next[oldName] !== undefined) { next[newName] = next[oldName]; delete next[oldName] }
      return next
    })
    getEntries(active).then(setEntries)
    getResults(active).then(setResults)
  }

  useEffect(() => {
    const init = {}
    entries.forEach(e => { init[e.player_name] = e.deck && e.deck !== 'Unknown' ? e.deck : '' })
    setDeckInputs(init)
  }, [entries])

  const sensors = useSensors(
  useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  )

const handleDragEnd = async (event) => {
  const { active: dragged, over } = event
  if (!over || dragged.id === over.id) return

  const [fromId, fromField] = dragged.id.split('|')
  const [toId, toField] = over.id.split('|')
  if (fromId === toId) return // stesso pairing, non ha senso scambiare

  const fromPairing = results.find(r => String(r.id) === fromId)
  const toPairing = results.find(r => String(r.id) === toId)
  if (!fromPairing || !toPairing) return

  const nameFrom = fromPairing[fromField]
  const nameTo = toPairing[toField]

  await swapPlayers(fromPairing.id, fromField, toPairing.id, toField, nameFrom, nameTo)
  getResults(active).then(setResults)
  }


  const handleDelete = async (id, name) => {
  if (!confirm(`Eliminare definitivamente "${name}"? Verranno rimossi anche tutti i punteggi e le statistiche legate a questo torneo dalla classifica.`)) return
  await deleteTournament(id)
  }

  useEffect(() => {
    if (!active) return
    const t = tournaments.find(x => x.id === active)
    if (!t) return
    setActiveTournament(t)
    getEntries(active).then(setEntries)
    getResults(active).then(setResults)
  }, [active, tournaments])

  const handleCreate = async () => {
    if (!newName.trim()) return
    const result = await createTournament(newName.trim())
    if (result) { setNewName(''); setEditMode(true) }
  }

  const handleAddPlayer = async () => {
    if (!playerInput.trim() || !active) return
    await addEntry(active, playerInput.trim(), deckInput.trim() || 'Unknown')
    getEntries(active).then(setEntries)
    setPlayerInput(''); setDeckInput('')
  }

  const handleStartRound = async () => {
    await startRound(active)
    getResults(active).then(setResults)
  }

  const handleResult = async (id, s1, s2) => {
    await submitResult(id, s1, s2)
    setResults(prev => prev.map(r => r.id === id ? { ...r, s1, s2 } : r))
  }

  const handleRewind = async (roundNum) => {
    if (!confirm(`Tornare al Round ${roundNum}? I round successivi verranno eliminati e potrai generare nuovi pairing.`)) return
    await rewindToRound(active, roundNum)
    getResults(active).then(setResults)
  }
  
    const handleFinishWithDecks = async () => {
    for (const e of entries) {
      const deck = (deckInputs[e.player_name] || '').trim() || 'Unknown'
      if (deck !== e.deck) await updateEntryDeck(active, e.player_name, deck)
    }
    await finishTournament(active)
    getEntries(active).then(setEntries)
  }

  const t = activeTournament
  const currentRound = t?.rounds || 0

  if (!active) return (
    <div>
      <Card title="Nuovo torneo">
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="inp" placeholder="Nome torneo" value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14 }} />
          <Btn primary onClick={handleCreate}>Crea</Btn>
        </div>
      </Card>
      {tournaments.length > 0 && (
        <Card title="Tornei">
          {tournaments.slice(0, 8).map(x => (
            <Row key={x.id}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{x.name}</div>
                <div style={{ fontSize: 12, color: '#666' }}>{x.date} · round {x.rounds}{x.finished ? ' · concluso' : ''}</div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {x.finished ? (
                  <>
                    <Btn sm onClick={() => { setActive(x.id); setEditMode(false) }}>Vedi</Btn>
                    <Btn sm onClick={() => { setActive(x.id); setEditMode(true) }}>Modifica</Btn>
                  </>
                ) : (
                  <Btn sm onClick={() => { setActive(x.id); setEditMode(true) }}>Riprendi</Btn>
                )}
                <Btn sm danger onClick={() => handleDelete(x.id, x.name)}>🗑</Btn>
              </div>
            </Row>
          ))}
        </Card>
      )}
    </div>
  )

  return (
    <div>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 500 }}>{t?.name}</div>
            <div style={{ fontSize: 12, color: '#666' }}>{t?.date} · Round {currentRound} · {entries.length} giocatori</div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {t?.finished && (
              <Btn sm onClick={() => setEditMode(m => !m)}>{editMode ? 'Sola lettura' : 'Modifica'}</Btn>
            )}
            <Btn sm onClick={() => setActive(null)}>← Torna</Btn>
          </div>
        </div>
      </Card>

      {currentRound === 0 && (
        <Card title="Giocatori">
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input placeholder="Nome" value={playerInput} onChange={e => setPlayerInput(e.target.value)}
              style={{ flex: 2, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14 }} />
            <input placeholder="Mazzo (opzionale)" value={deckInput} onChange={e => setDeckInput(e.target.value)}
              style={{ flex: 2, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14 }} />
            <Btn primary onClick={handleAddPlayer}>Add</Btn>
          </div>
          {entries.map(e => (
            <Row key={e.id}>
              <div style={{ flex: 1 }}>
                {renamingPlayer === e.player_name ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input value={renamePlayerValue} onChange={ev => setRenamePlayerValue(ev.target.value)}
                      onKeyDown={ev => ev.key === 'Enter' && confirmRenamePlayer()}
                      onBlur={confirmRenamePlayer} autoFocus
                      style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }} />
                  </div>
                ) : (
                  <>
                    <span style={{ fontWeight: 500 }}>{e.player_name}</span>
                    <button onClick={() => startRenamePlayer(e.player_name)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 6, color: '#999', fontSize: 12 }}>✎</button>
                    <span style={{ marginLeft: 8, fontSize: 12, padding: '2px 8px', borderRadius: 6,
                      background: '#f0f0f0', border: '0.5px solid #e0e0e0' }}>{e.deck}</span>
                  </>
                )}
              </div>
              <Btn sm danger onClick={() => { removeEntry(active, e.player_name); getEntries(active).then(setEntries) }}>✕</Btn>
            </Row>
          ))}
          {entries.length >= 2 && (
            <Btn primary onClick={handleStartRound} style={{ width: '100%', marginTop: 12 }}>
              Inizia Round 1 ({entries.length} giocatori)
            </Btn>
          )}
        </Card>
      )}

      {!editMode && t?.finished && (
        <>
          <Card title="Classifica finale">
            {calcStandings(entries.map(e => e.player_name), results).map((p, i) => (
              <Row key={p.name}>
              <span style={{ minWidth: 22, color: i < 2 ? '#BA7517' : '#666', fontSize: 13 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
              <span style={{ fontSize: 13, color: '#534AB7', fontWeight: 500 }}>{p.pts}pt</span>
              <span style={{ fontSize: 11, color: '#666' }}>{(p.omw * 100).toFixed(0)}% OMW</span>
              <span style={{ fontSize: 11, color: '#666' }}>{(p.gwp * 100).toFixed(0)}% GW</span>
            </Row>
            ))}
          </Card>
          {Array.from({ length: currentRound }, (_, i) => i + 1).map(roundNum => (
            <Card key={roundNum} title={`Round ${roundNum}`}>
              {results.filter(r => r.round === roundNum).map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '0.5px solid #f5f5f5', opacity: p.bye ? 0.6 : 1 }}>
                  <span style={{ flex: 1 }}>{p.p1}</span>
                  {p.bye ? <span style={{ fontSize: 11, color: '#666' }}>BYE 2-0</span> : (
                    <>
                      <span style={{ fontWeight: 500 }}>{p.s1} - {p.s2}</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{p.p2}</span>
                    </>
                  )}
                </div>
              ))}
            </Card>
          ))}
        </>
      )}

      {editMode && currentRound > 0 && (
      <Card title="Giocatori & Mazzi">
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Correggi nomi (✎) e inserisci i mazzi giocati da ciascuno.
        </p>
        {entries.map(e => (
          <div key={e.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0' }}>
            {renamingPlayer === e.player_name ? (
              <input value={renamePlayerValue} onChange={ev => setRenamePlayerValue(ev.target.value)}
                onKeyDown={ev => ev.key === 'Enter' && confirmRenamePlayer()}
                onBlur={confirmRenamePlayer} autoFocus
                style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 13, fontWeight: 500 }} />
            ) : (
              <span style={{ flex: 1, fontWeight: 500, fontSize: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                {e.player_name}
                <button onClick={() => startRenamePlayer(e.player_name)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#999', fontSize: 12 }}>✎</button>
              </span>
            )}
            <input
              placeholder="Mazzo"
              value={deckInputs[e.player_name] ?? ''}
              onChange={ev => setDeckInputs(prev => ({ ...prev, [e.player_name]: ev.target.value }))}
              style={{ flex: 1, padding: '6px 10px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 13 }}
            />
          </div>
        ))}
      </Card>
    )}

      {editMode && currentRound > 0 && Array.from({ length: currentRound }, (_, i) => i + 1).map(roundNum => {
        const pairings = results.filter(r => r.round === roundNum)
        const isLast = roundNum === currentRound
        return (
          <Card key={roundNum} title={`Round ${roundNum}`} extra={
            !isLast ? <Btn sm onClick={() => handleRewind(roundNum)}>Correggi da qui</Btn> : null
          }>
            {isLast && (
              <p style={{ fontSize: 12, color: '#999', marginBottom: 8 }}>
                Trascina un nome (⠿) su un altro per scambiare i giocatori tra i pairing.
              </p>
            )}
            {isLast ? (
              dragEnabled ? (
                <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
                  {pairings.map(p => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                      padding: '10px 0', borderBottom: '0.5px solid #f0f0f0', opacity: p.bye ? 0.6 : 1 }}>
                      <div style={{ flex: 1 }}>
                        <DroppableSlot id={`${p.id}|p1`}>
                          <DraggableName id={`${p.id}|p1`} name={p.p1} />
                        </DroppableSlot>
                      </div>
                      {p.bye ? (
                        <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#E1F5EE', color: '#085041' }}>BYE 2-0</span>
                      ) : (
                        <>
                          <input type="number" min={0} max={2} value={p.s1}
                            onChange={e => handleResult(p.id, parseInt(e.target.value) || 0, p.s2)}
                            style={{ width: 44, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 16, textAlign: 'center' }} />
                          <span style={{ fontSize: 11, color: '#666' }}>vs</span>
                          <input type="number" min={0} max={2} value={p.s2}
                            onChange={e => handleResult(p.id, p.s1, parseInt(e.target.value) || 0)}
                            style={{ width: 44, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 16, textAlign: 'center' }} />
                          <div style={{ flex: 1, textAlign: 'right' }}>
                            <DroppableSlot id={`${p.id}|p2`}>
                              <DraggableName id={`${p.id}|p2`} name={p.p2} />
                            </DroppableSlot>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </DndContext>
              ) : (
                pairings.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '10px 0', borderBottom: '0.5px solid #f0f0f0', opacity: p.bye ? 0.6 : 1 }}>
                    <span style={{ flex: 1, fontWeight: 500 }}>{p.p1}</span>
                    {p.bye ? (
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#E1F5EE', color: '#085041' }}>BYE 2-0</span>
                    ) : (
                      <>
                        <input type="number" min={0} max={2} value={p.s1}
                          onChange={e => handleResult(p.id, parseInt(e.target.value) || 0, p.s2)}
                          style={{ width: 44, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 16, textAlign: 'center' }} />
                        <span style={{ fontSize: 11, color: '#666' }}>vs</span>
                        <input type="number" min={0} max={2} value={p.s2}
                          onChange={e => handleResult(p.id, p.s1, parseInt(e.target.value) || 0)}
                          style={{ width: 44, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 16, textAlign: 'center' }} />
                        <span style={{ flex: 1, fontWeight: 500, textAlign: 'right' }}>{p.p2}</span>
                      </>
                    )}
                  </div>
                ))
              )
            ) : (
              pairings.map(p => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8,
                  padding: '10px 0', borderBottom: '0.5px solid #f0f0f0', opacity: p.bye ? 0.6 : 1 }}>
                  <span style={{ flex: 1, fontWeight: 500 }}>{p.p1}</span>
                  {p.bye ? (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: '#E1F5EE', color: '#085041' }}>BYE 2-0</span>
                  ) : (
                    <>
                      <span style={{ fontWeight: 500 }}>{p.s1} - {p.s2}</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>{p.p2}</span>
                    </>
                  )}
                </div>
              ))
            )}
            {isLast && (
              <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                <Btn
                  onClick={() => setDragEnabled(d => !d)}
                  style={{
                    background: dragEnabled ? '#FFF3E0' : 'none',
                    borderColor: dragEnabled ? '#BA7517' : '#ccc',
                    color: dragEnabled ? '#BA7517' : '#666'
                  }}>
                  {dragEnabled ? '⠿ Drag ON — tocca per disattivare' : '⠿ Modifica pairing'}
                </Btn>
                <Btn success onClick={handleStartRound}>Genera Round {currentRound + 1}</Btn>
                <Btn primary onClick={handleFinishWithDecks}>Salva classifica / Chiudi torneo</Btn>
              </div>
            )}
          </Card>
        )
      })}

      {editMode && currentRound > 0 && (
        <Card title="Classifica parziale">
          {calcStandings(entries.map(e => e.player_name), results).map((p, i) => (
            <Row key={p.name}>
              <span style={{ minWidth: 22, color: i < 2 ? '#BA7517' : '#666', fontSize: 13 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{p.name}</span>
              <span style={{ fontSize: 13, color: '#534AB7', fontWeight: 500 }}>{p.pts}pt</span>
              <span style={{ fontSize: 11, color: '#666' }}>{(p.omw * 100).toFixed(0)}% OMW</span>
            </Row>
          ))}
        </Card>
      )}
    </div>
  )
}

// ---- TIMER e Pairings---

function PlayerView() {
  const { remaining, totalSec, running } = useTimer()
  const [tournament, setTournament] = useState(null)
  const [results, setResults] = useState([])
  const [savedIds, setSavedIds] = useState(new Set())

  // Iscrizione
  const [playerName, setPlayerName] = useState('')
  const [playerDeck, setPlayerDeck] = useState('')
  const [registering, setRegistering] = useState(false)
  const [registered, setRegistered] = useState(false)
  const [alreadyIn, setAlreadyIn] = useState(false)
  const [registerError, setRegisterError] = useState('')

  // Vista personale
  const [myName, setMyName] = useState(() => localStorage.getItem('mtg_my_name') || '')
  const [searchName, setSearchName] = useState('')

  const load = async () => {
    const { data: tdata } = await supabase
      .from('tournaments')
      .select('*')
      .eq('finished', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (!tdata) { setTournament(null); setResults([]); return }
    setTournament(tdata)

    if (tdata.rounds > 0) {
      const { data: rdata } = await supabase
        .from('results')
        .select('*')
        .eq('tournament_id', tdata.id)
        .eq('round', tdata.rounds)
      setResults(rdata || [])
    }
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [])

  const handleRegister = async () => {
    if (!playerName.trim()) return
    setRegistering(true)
    setRegisterError('')

    // controlla se già iscritto
    const { data: existing } = await supabase
      .from('entries')
      .select('id')
      .eq('tournament_id', tournament.id)
      .eq('player_name', playerName.trim())
      .maybeSingle()

    if (existing) {
      setAlreadyIn(true)
      setMyName(playerName.trim())
      localStorage.setItem('mtg_my_name', playerName.trim())
      setRegistering(false)
      return
    }

    const { error } = await supabase.from('entries').insert({
      tournament_id: tournament.id,
      player_name: playerName.trim(),
      deck: playerDeck.trim() || 'Unknown'
    })

    if (error) {
      setRegisterError('Errore durante l\'iscrizione. Riprova.')
      setRegistering(false)
      return
    }

    setMyName(playerName.trim())
    localStorage.setItem('mtg_my_name', playerName.trim())
    setRegistered(true)
    setRegistering(false)
  }

  const handleSubmit = async (id, s1, s2) => {
    await supabase.from('results').update({ s1, s2 }).eq('id', id)
    setResults(prev => prev.map(r => r.id === id ? { ...r, s1, s2 } : r))
    setSavedIds(prev => new Set([...prev, id]))
    setTimeout(() => setSavedIds(prev => { const n = new Set(prev); n.delete(id); return n }), 1500)
  }

  const pct = Math.max(0, remaining / totalSec) * 100
  const color = remaining <= 0 ? '#E24B4A' : remaining < 600 ? '#BA7517' : '#534AB7'

  // Trova il tavolo del giocatore cercato
  const activeName = myName || searchName
  const myPairing = activeName
    ? results.find(r => r.p1 === activeName || r.p2 === activeName)
    : null
  const myTableNum = myPairing
    ? results.indexOf(myPairing) + 1
    : null

  return (
    <div style={{ minHeight: '100vh', background: '#f5f5f5', fontFamily: 'system-ui' }}>

      {/* Timer sticky in cima */}
      <div style={{ position: 'sticky', top: 0, background: '#0e0e16', color: 'white', padding: '14px 16px', textAlign: 'center', zIndex: 10 }}>
        <div style={{ fontSize: 'min(15vw, 56px)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color, letterSpacing: -2, lineHeight: 1 }}>
          {fmt(remaining)}
        </div>
        <div style={{ width: '90%', maxWidth: 400, height: 6, borderRadius: 3, background: '#222', margin: '8px auto 0' }}>
          <div style={{ height: '100%', borderRadius: 3, background: color, width: `${pct}%`, transition: 'width 1s linear' }} />
        </div>
        <div style={{ fontSize: 11, marginTop: 6, color: running ? '#1D9E75' : '#888' }}>
          {running ? '● In corso' : '⏸ In pausa'}
        </div>
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', padding: 16 }}>

        {/* Nessun torneo attivo */}
        {!tournament && (
          <div style={{ textAlign: 'center', color: '#999', padding: 40 }}>
            Nessun torneo in corso.
          </div>
        )}

        {tournament && tournament.rounds === 0 && !registered && !alreadyIn && (
          /* Form iscrizione */
          <div style={{ background: 'white', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>{tournament.name}</div>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 20 }}>Il torneo non è ancora iniziato — iscriviti!</div>

            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Il tuo nome</div>
              <input
                placeholder="Es. Mario"
                value={playerName}
                onChange={e => setPlayerName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRegister()}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 15, boxSizing: 'border-box' }}
              />
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#666', marginBottom: 4 }}>Il tuo mazzo</div>
              <input
                placeholder="Es. Affinity"
                value={playerDeck}
                onChange={e => setPlayerDeck(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleRegister()}
                style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 15, boxSizing: 'border-box' }}
              />
              <div style={{ fontSize: 11, color: '#999', marginTop: 4 }}>Il mazzo non sarà visibile agli altri giocatori.</div>
            </div>

            {registerError && <div style={{ fontSize: 13, color: '#E24B4A', marginBottom: 8 }}>{registerError}</div>}

            <button
              onClick={handleRegister}
              disabled={registering || !playerName.trim()}
              style={{ width: '100%', padding: '12px', borderRadius: 8, border: 'none', background: '#3C3489', color: 'white', fontSize: 15, fontWeight: 500, cursor: playerName.trim() ? 'pointer' : 'not-allowed', opacity: playerName.trim() ? 1 : 0.5 }}>
              {registering ? 'Iscrizione...' : 'Iscriviti al torneo'}
            </button>
          </div>
        )}

        {tournament && tournament.rounds === 0 && (registered || alreadyIn) && (
          /* Iscrizione confermata, torneo non ancora iniziato */
          <div style={{ background: 'white', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: 20, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
            <div style={{ fontSize: 16, fontWeight: 500, marginBottom: 4 }}>
              {alreadyIn ? 'Sei già iscritto!' : 'Iscrizione confermata!'}
            </div>
            <div style={{ fontSize: 13, color: '#666' }}>Ciao {myName}, sei iscritto a <b>{tournament.name}</b>.<br />Attendi l'inizio del torneo.</div>
          </div>
        )}

        {tournament && tournament.rounds > 0 && (
          <>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
              {tournament.name} · Round {tournament.rounds}
            </div>

            {/* Box "Il mio tavolo" */}
            {myPairing ? (
              <div style={{ background: '#3C3489', borderRadius: 12, padding: 20, marginBottom: 16, color: 'white', textAlign: 'center' }}>
                <div style={{ fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Il tuo tavolo</div>
                <div style={{ fontSize: 48, fontWeight: 700, marginBottom: 4 }}>🪑 {myTableNum}</div>
                {myPairing.bye ? (
                  <div style={{ fontSize: 15 }}>Hai il BYE questo round — vittoria automatica 2-0!</div>
                ) : (
                  <div style={{ fontSize: 16, fontWeight: 500 }}>
                    {myPairing.p1 === activeName ? myPairing.p2 : myPairing.p1}
                  </div>
                )}
                {!myPairing.bye && (
                  <div style={{ fontSize: 12, opacity: 0.7, marginTop: 4 }}>
                    Tu sei {myPairing.p1 === activeName ? 'Giocatore 1' : 'Giocatore 2'}
                  </div>
                )}
              </div>
            ) : (
              /* Ricerca per nome se non trovato in automatico */
              <div style={{ background: 'white', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>Cerca il tuo nome per vedere il tuo tavolo</div>
                <input
                  placeholder="Il tuo nome..."
                  value={searchName}
                  onChange={e => setSearchName(e.target.value)}
                  style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14, boxSizing: 'border-box' }}
                />
                {searchName && !myPairing && (
                  <div style={{ fontSize: 12, color: '#E24B4A', marginTop: 6 }}>Nome non trovato nei pairing di questo round.</div>
                )}
              </div>
            )}

            {/* Lista completa tavoli */}
            <div style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
              Tutti i tavoli
            </div>
            {results.length === 0 && (
              <div style={{ textAlign: 'center', color: '#999', padding: 20 }}>In attesa dei pairing...</div>
            )}
            {results.map((p, idx) => (
              <div key={p.id} style={{
                background: 'white', borderRadius: 12,
                border: `0.5px solid ${(p.p1 === activeName || p.p2 === activeName) ? '#3C3489' : '#e0e0e0'}`,
                padding: 16, marginBottom: 10,
                boxShadow: (p.p1 === activeName || p.p2 === activeName) ? '0 0 0 2px #3C3489' : 'none'
              }}>
                <div style={{ fontSize: 11, color: '#999', marginBottom: 6, fontWeight: 500 }}>TAVOLO {idx + 1}</div>
                {p.bye ? (
                  <div style={{ textAlign: 'center', fontWeight: 500 }}>{p.p1} — BYE (2-0)</div>
                ) : (
                  <>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10, fontWeight: 500 }}>
                      <span>{p.p1}</span>
                      <span style={{ color: '#999', fontWeight: 400 }}>vs</span>
                      <span>{p.p2}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
                      <ScoreSelect value={p.s1} onChange={v => handleSubmit(p.id, v, p.s2)} />
                      <span style={{ color: '#999' }}>—</span>
                      <ScoreSelect value={p.s2} onChange={v => handleSubmit(p.id, p.s1, v)} />
                    </div>
                    {savedIds.has(p.id) && (
                      <div style={{ textAlign: 'center', fontSize: 12, color: '#0F6E56', marginTop: 8 }}>✓ Salvato</div>
                    )}
                  </>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}




function ScoreSelect({ value, onChange }) {
  return (
    <select value={value} onChange={e => onChange(parseInt(e.target.value))}
      style={{ fontSize: 26, fontWeight: 600, padding: '8px 16px', borderRadius: 10, border: '0.5px solid #ccc', textAlign: 'center' }}>
      <option value={0}>0</option>
      <option value={1}>1</option>
      <option value={2}>2</option>
    </select>
  )
}

function DraggableName({ id, name }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id })
  return (
    <span ref={setNodeRef} {...listeners} {...attributes}
      style={{
        fontWeight: 500, cursor: 'grab', padding: '4px 8px', borderRadius: 6,
        background: isDragging ? '#E1DCFB' : 'transparent',
        opacity: isDragging ? 0.5 : 1, touchAction: 'none', display: 'inline-block'
      }}>
      {name} <span style={{ color: '#bbb', fontSize: 11 }}>⠿</span>
    </span>
  )
}

function DroppableSlot({ id, children }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <span ref={setNodeRef} style={{
      display: 'inline-block', borderRadius: 6,
      background: isOver ? '#F0EEFB' : 'transparent',
      outline: isOver ? '2px dashed #534AB7' : 'none'
    }}>
      {children}
    </span>
  )
}

function TimerTab() {
  const { remaining, totalSec, running, start, pause, reset, addTime } = useTimer()
  const [customMin, setCustomMin] = useState(50)
  const pct = Math.max(0, remaining / totalSec) * 100
  const cls = remaining <= 0 ? '#E24B4A' : remaining < 600 ? '#BA7517' : '#534AB7'

  const playUrl = `${window.location.origin}${window.location.pathname}#/play`

  return (
    <div>
      <Card title="Condividi con i giocatori">
  <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
    Timer e pairing in un'unica pagina: i giocatori scansionano una volta e restano lì per tutta la serata.
  </p>
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
    <img src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(playUrl)}`}
      alt="QR" style={{ borderRadius: 8, border: '0.5px solid #e0e0e0' }} />
    <div style={{ flex: 1, minWidth: 180 }}>
      <input readOnly value={playUrl} onClick={e => e.target.select()}
        style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 12 }} />
      <Btn sm onClick={() => navigator.clipboard.writeText(playUrl)} style={{ marginTop: 8 }}>📋 Copia link</Btn>
    </div>
  </div>
</Card>
      <Card title="Timer Round">
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 64, fontWeight: 500, letterSpacing: -2, color: cls, fontVariantNumeric: 'tabular-nums', margin: '24px 0' }}>
            {fmt(remaining)}
          </div>
          <div style={{ height: 6, borderRadius: 3, background: '#f0f0f0', marginBottom: 24 }}>
            <div style={{ height: '100%', borderRadius: 3, background: cls, width: `${pct}%`, transition: 'width 1s linear' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 8, marginBottom: 16 }}>
            <Btn primary onClick={running ? pause : start} style={{ fontSize: 18, padding: '10px 24px' }}>
              {running ? '⏸ Pausa' : '▶ Avvia'}
            </Btn>
            <Btn onClick={() => reset()}>↺ Reset</Btn>
          </div>
          <div style={{ display: 'flex', justifyContent: 'center', gap: 6 }}>
            {[-5, -1, 1, 5, 10].map(m => (
              <Btn key={m} sm onClick={() => addTime(m)}>{m > 0 ? '+' : ''}{m}m</Btn>
            ))}
          </div>
        </div>
      </Card>
      <Card title="Durata personalizzata">
        <div style={{ display: 'flex', gap: 8 }}>
          <input type="number" min={1} max={180} value={customMin}
            onChange={e => setCustomMin(parseInt(e.target.value) || 50)}
            style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14 }} />
          <span style={{ alignSelf: 'center', color: '#666' }}>min</span>
          <Btn primary onClick={() => reset(customMin * 60)}>Imposta</Btn>
        </div>
      </Card>
    </div>
  )
}

// ---- STANDINGS ----
function StandingsTab() {
  const [data, setData] = useState([])
  const [weeks, setWeeks] = useState([])
  const [weekFilter, setWeekFilter] = useState('all')
  const [renamingPlayer, setRenamingPlayer] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [seasons, setSeasons] = useState([])
  const [activeSeason, setActiveSeason] = useState(null)

  const loadSeasons = () => {
    supabase.from('seasons').select('*').order('start_date', { ascending: false })
      .then(({ data }) => {
        setSeasons(data || [])
        const active = data?.find(s => s.active)
        if (active) setActiveSeason(active.id)
      })
  }

  const loadData = (season) => {
    let query = supabase.from('leaderboard').select('*')
    if (season) {
      const s = seasons.find(x => x.id === season)
      if (s) {
        query = query.gte('week_start', s.start_date).lte('week_start', s.end_date)
      }
    }
    query.then(({ data }) => {
      if (!data) return
      const best = {}
      data.forEach(r => {
        const key = r.player_name + '|' + r.week_start
        if (!best[key] || r.pts > best[key].pts) best[key] = r
      })
      const rows = Object.values(best)
      setData(rows)
      setWeeks([...new Set(rows.map(r => r.week_start))].sort().reverse())
    })
  }

  useEffect(() => { loadSeasons() }, [])
  useEffect(() => { loadData(activeSeason) }, [activeSeason, seasons])

  const startRename = (name) => { setRenamingPlayer(name); setRenameValue(name) }

  const confirmRename = async () => {
    const oldName = renamingPlayer
    const newName = renameValue.trim()
    if (!newName || newName === oldName) { setRenamingPlayer(null); return }
    if (!confirm(`Rinominare "${oldName}" in "${newName}" in tutta la classifica e lo storico dei tornei?`)) {
      setRenamingPlayer(null); return
    }
    await supabase.from('leaderboard').update({ player_name: newName }).eq('player_name', oldName)
    await supabase.from('entries').update({ player_name: newName }).eq('player_name', oldName)
    await supabase.from('results').update({ p1: newName }).eq('p1', oldName)
    await supabase.from('results').update({ p2: newName }).eq('p2', oldName)
    setRenamingPlayer(null)
    loadData(activeSeason)
  }

  const seasonTotals = {}
  data.forEach(r => {
    if (!seasonTotals[r.player_name]) seasonTotals[r.player_name] = { name: r.player_name, total: 0, count: 0 }
    seasonTotals[r.player_name].total += r.pts
    seasonTotals[r.player_name].count++
  })
  const sorted = Object.values(seasonTotals).sort((a, b) => b.total - a.total)
  const weekData = weekFilter !== 'all' ? data.filter(r => r.week_start === weekFilter).sort((a, b) => b.pts - a.pts) : []
  const top5 = sorted.slice(0, 5)

  return (
    <div>
      <Card title="Stagione" extra={
        <select value={activeSeason || ''} onChange={e => { setActiveSeason(e.target.value || null); setWeekFilter('all') }}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc' }}>
          <option value="">Tutte le stagioni</option>
          {seasons.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      }>
        {activeSeason ? (
          (() => {
            const s = seasons.find(x => x.id === activeSeason)
            return s ? (
              <div style={{ fontSize: 13, color: '#666' }}>
                {s.name} · {s.start_date} → {s.end_date}
                {s.active && <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 6px', borderRadius: 6, background: '#E1F5EE', color: '#085041' }}>in corso</span>}
              </div>
            ) : null
          })()
        ) : (
          <div style={{ fontSize: 13, color: '#666' }}>Mostro tutti i tornei di tutte le stagioni.</div>
        )}
      </Card>

      <Card title="Classifica" extra={
        <select value={weekFilter} onChange={e => setWeekFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc' }}>
          <option value="all">Stagione</option>
          {weeks.map(w => <option key={w} value={w}>Sett. {w}</option>)}
        </select>
      }>
        {weekFilter === 'all' ? (
          sorted.length === 0 ? <Empty /> :
          sorted.map((p, i) => (
            <Row key={p.name}>
              <span style={{ minWidth: 22, color: i < 3 ? '#BA7517' : '#666', fontSize: 13 }}>
                {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}
              </span>
              {renamingPlayer === p.name ? (
                <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                  <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmRename()} autoFocus
                    style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }} />
                  <Btn sm success onClick={confirmRename}>✓</Btn>
                  <Btn sm onClick={() => setRenamingPlayer(null)}>✕</Btn>
                </div>
              ) : (
                <span style={{ flex: 1, fontWeight: 500 }}>
                  {p.name}
                  <button onClick={() => startRename(p.name)}
                    style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 6, color: '#999', fontSize: 12 }}>✎</button>
                </span>
              )}
              <span style={{ color: '#534AB7', fontWeight: 500 }}>{p.total}pt</span>
              <span style={{ fontSize: 11, color: '#666' }}>{p.count} tornei</span>
            </Row>
          ))
        ) : (
          weekData.length === 0 ? <Empty /> :
          weekData.map((p, i) => (
            <Row key={p.id}>
              <span style={{ minWidth: 22, color: '#666', fontSize: 13 }}>{i + 1}</span>
              <span style={{ flex: 1, fontWeight: 500 }}>{p.player_name}</span>
              <span style={{ fontSize: 12, padding: '2px 8px', borderRadius: 6, background: '#f0f0f0' }}>{p.deck}</span>
              <span style={{ color: '#534AB7', fontWeight: 500 }}>{p.pts}pt</span>
            </Row>
          ))
        )}
      </Card>

      {top5.length > 0 && (
        <Card title="Top 5 — punti stagione">
          <div style={{ height: 200 }}>
            <Bar
              data={{ labels: top5.map(p => p.name), datasets: [{ label: 'Punti', data: top5.map(p => p.total), backgroundColor: '#534AB7', borderRadius: 6 }] }}
              options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }}
            />
          </div>
        </Card>
      )}
    </div>
  )
}

// ---- DATABASE ----
function DatabaseTab() {
  const [seasons, setSeasons] = useState([])
  const [seasonName, setSeasonName] = useState('')
  const [seasonStart, setSeasonStart] = useState('')
  const [seasonEnd, setSeasonEnd] = useState('')
  const [deckStats, setDeckStats] = useState([])
  const [history, setHistory] = useState([])
  const [counts, setCounts] = useState({ tournaments: 0, players: 0, decks: 0 })
  const [showLegacy, setShowLegacy] = useState(false)

  const [legacyEntries, setLegacyEntries] = useState([])
  const [formPlayer, setFormPlayer] = useState('')
  const [formDate, setFormDate] = useState('')
  const [formPts, setFormPts] = useState('')
  const [formWins, setFormWins] = useState('')
  const [formLosses, setFormLosses] = useState('')
  const [formDraws, setFormDraws] = useState('')
  const [formDeck, setFormDeck] = useState('')

  const [deckFilter, setDeckFilter] = useState('top')
  const [renamingDeck, setRenamingDeck] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const [playerStats, setPlayerStats] = useState([])
  const [renamingPlayer, setRenamingPlayer] = useState(null)
  const [renamePlayerValue, setRenamePlayerValue] = useState('')

  const startRename = (deckName) => { setRenamingDeck(deckName); setRenameValue(deckName) }

  const loadSeasons = () => {
  supabase.from('seasons').select('*').order('start_date', { ascending: false })
    .then(({ data }) => setSeasons(data || []))
  }

  const addSeason = async () => {
    if (!seasonName.trim() || !seasonStart || !seasonEnd) return
    await supabase.from('seasons').insert({
      name: seasonName.trim(),
      start_date: seasonStart,
      end_date: seasonEnd,
      active: false
    })
    setSeasonName(''); setSeasonStart(''); setSeasonEnd('')
    loadSeasons()
  }

  const setActiveSeason = async (id) => {
    await supabase.from('seasons').update({ active: false }).neq('id', id)
    await supabase.from('seasons').update({ active: true }).eq('id', id)
    loadSeasons()
  }

  const deleteSeason = async (id) => {
    if (!confirm('Eliminare questa stagione? I tornei e i punteggi NON vengono cancellati.')) return
    await supabase.from('seasons').delete().eq('id', id)
    loadSeasons()
  }

  const confirmRename = async () => {
    const oldName = renamingDeck
    const newName = renameValue.trim()
    if (!newName || newName === oldName) { setRenamingDeck(null); return }
    if (!confirm(`Rinominare "${oldName}" in "${newName}" in tutto lo storico? Se "${newName}" esiste già, le statistiche verranno unite.`)) {
      setRenamingDeck(null); return
    }
    await supabase.from('leaderboard').update({ deck: newName }).eq('deck', oldName)
    await supabase.from('entries').update({ deck: newName }).eq('deck', oldName)
    setRenamingDeck(null)
    loadStats()
  }

  const startRenamePlayer = (name) => { setRenamingPlayer(name); setRenamePlayerValue(name) }

  const confirmRenamePlayer = async () => {
    const oldName = renamingPlayer
    const newName = renamePlayerValue.trim()
    if (!newName || newName === oldName) { setRenamingPlayer(null); return }
    if (!confirm(`Rinominare "${oldName}" in "${newName}" in tutta la classifica e lo storico dei tornei? Se "${newName}" esiste già, le statistiche verranno unite.`)) {
      setRenamingPlayer(null); return
    }
    await supabase.from('leaderboard').update({ player_name: newName }).eq('player_name', oldName)
    await supabase.from('entries').update({ player_name: newName }).eq('player_name', oldName)
    await supabase.from('results').update({ p1: newName }).eq('p1', oldName)
    await supabase.from('results').update({ p2: newName }).eq('p2', oldName)
    setRenamingPlayer(null)
    loadStats()
  }

  const loadStats = () => {
    supabase.from('tournaments').select('*').eq('finished', true).order('created_at', { ascending: false }).then(({ data }) => {
      setHistory(data || [])
      setCounts(c => ({ ...c, tournaments: data?.length || 0 }))
    })
    supabase.from('leaderboard').select('*').then(({ data }) => {
      if (!data) return
      const players = new Set(data.map(r => r.player_name)).size
      const deckMap = {}
      const playerMap = {}
      data.forEach(r => {
        if (!deckMap[r.deck]) deckMap[r.deck] = { deck: r.deck, games: 0, wins: 0 }
        deckMap[r.deck].games += r.wins + r.losses + r.draws
        deckMap[r.deck].wins += r.wins

        if (!playerMap[r.player_name]) playerMap[r.player_name] = { name: r.player_name, games: 0, wins: 0, losses: 0, draws: 0, pts: 0, tournaments: 0 }
        playerMap[r.player_name].games += r.wins + r.losses + r.draws
        playerMap[r.player_name].wins += r.wins
        playerMap[r.player_name].losses += r.losses
        playerMap[r.player_name].draws += r.draws
        playerMap[r.player_name].pts += r.pts
        playerMap[r.player_name].tournaments += 1
      })
      setDeckStats(Object.values(deckMap).sort((a, b) => b.games - a.games))
      setPlayerStats(Object.values(playerMap).sort((a, b) => {
        if (b.games !== a.games) return b.games - a.games
        const wrA = a.games > 0 ? a.wins / a.games : 0
        const wrB = b.games > 0 ? b.wins / b.games : 0
        return wrB - wrA
      }))
      setCounts(c => ({ ...c, players, decks: Object.keys(deckMap).length }))
    })
  }
  const exportAll = async () => {
  const [t, e, r, l] = await Promise.all([
    supabase.from('tournaments').select('*').order('created_at'),
    supabase.from('entries').select('*'),
    supabase.from('results').select('*'),
    supabase.from('leaderboard').select('*'),
  ])
  const backup = {
    exportedAt: new Date().toISOString(),
    tournaments: t.data || [],
    entries: e.data || [],
    results: r.data || [],
    leaderboard: l.data || [],
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `mtg-pauper-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const importAll = async (e) => {
  const file = e.target.files[0]
  if (!file) return
  if (!confirm('Importare questo backup? I dati esistenti NON vengono cancellati — le righe del backup vengono aggiunte. Se vuoi sovrascrivere tutto, cancella prima i dati da Supabase.')) return
  const text = await file.text()
  const backup = JSON.parse(text)

  if (backup.tournaments?.length) await supabase.from('tournaments').upsert(backup.tournaments, { onConflict: 'id' })
  if (backup.entries?.length)     await supabase.from('entries').upsert(backup.entries, { onConflict: 'id' })
  if (backup.results?.length)     await supabase.from('results').upsert(backup.results, { onConflict: 'id' })
  if (backup.leaderboard?.length) await supabase.from('leaderboard').upsert(backup.leaderboard, { onConflict: 'id' })

  alert('Backup importato correttamente.')
  loadStats()
  loadLegacy()
  e.target.value = ''
  }

  const loadLegacy = () => {
    supabase.from('leaderboard').select('*').is('tournament_id', null)
      .order('week_start', { ascending: false })
      .then(({ data }) => setLegacyEntries(data || []))
  }

  useEffect(() => {
    loadStats()
    loadLegacy()
    loadSeasons()
  }, [])

  const addLegacy = async () => {
    if (!formPlayer.trim() || !formDate || formPts === '') return
    await supabase.from('leaderboard').insert({
      player_name: formPlayer.trim(),
      week_start: getWeekStart(formDate),
      pts: parseInt(formPts) || 0,
      wins: parseInt(formWins) || 0,
      losses: parseInt(formLosses) || 0,
      draws: parseInt(formDraws) || 0,
      deck: formDeck.trim() || 'Unknown',
      tournament_id: null
    })
    setFormPlayer(''); setFormDate(''); setFormPts(''); setFormWins(''); setFormLosses(''); setFormDraws(''); setFormDeck('')
    loadLegacy()
    loadStats()
  }

  const deleteLegacy = async (id) => {
    await supabase.from('leaderboard').delete().eq('id', id)
    loadLegacy()
    loadStats()
  }

  const inputStyle = { padding: '8px 12px', borderRadius: 8, border: '0.5px solid #ccc', fontSize: 14, width: '100%' }

  const visibleDecks = deckFilter === 'low'
  ? deckStats.filter(d => d.games <= 4)
  : deckFilter === 'all'
    ? deckStats
    : deckStats.filter(d => d.games > 4)

  return (
    <div>
      <Card title="Statistiche globali">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
          {[['Tornei', counts.tournaments], ['Giocatori', counts.players], ['Mazzi', counts.decks]].map(([l, v]) => (
            <div key={l} style={{ background: '#f5f5f5', borderRadius: 8, padding: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 24, fontWeight: 500 }}>{v}</div>
              <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>{l}</div>
            </div>
          ))}
        </div>
      </Card>
      <Card title="Gestione stagioni">
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Crea e gestisci le stagioni. La stagione "attiva" è quella mostrata di default nella tab Rank.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input placeholder="Nome stagione (es. Stagione 1)" value={seasonName}
            onChange={e => setSeasonName(e.target.value)} style={inputStyle} />
          <input type="date" value={seasonStart} onChange={e => setSeasonStart(e.target.value)} style={inputStyle} />
          <input type="date" value={seasonEnd} onChange={e => setSeasonEnd(e.target.value)} style={inputStyle} />
        </div>
        <Btn primary onClick={addSeason} style={{ width: '100%', marginBottom: 12 }}>Aggiungi stagione</Btn>

        {seasons.map(s => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '0.5px solid #f0f0f0' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                {s.name}
                {s.active && <span style={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, background: '#E1F5EE', color: '#085041' }}>attiva</span>}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{s.start_date} → {s.end_date}</div>
            </div>
            <Btn sm onClick={() => setActiveSeason(s.id)} style={{ whiteSpace: 'nowrap' }}>
              {s.active ? '✓ Attiva' : 'Imposta attiva'}
            </Btn>
            <Btn sm danger onClick={() => deleteSeason(s.id)}>🗑</Btn>
          </div>
        ))}
        {seasons.length === 0 && <Empty />}
      </Card>

      <Card title="Aggiungi punteggio storico">
        <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
          Per inserire punteggi di tornei giocati prima di usare l'app — verranno inclusi nella classifica stagionale.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
          <input placeholder="Nome giocatore" value={formPlayer} onChange={e => setFormPlayer(e.target.value)} style={inputStyle} />
          <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Punti" value={formPts} onChange={e => setFormPts(e.target.value)} style={inputStyle} />
          <input placeholder="Mazzo (opzionale)" value={formDeck} onChange={e => setFormDeck(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Vittorie" value={formWins} onChange={e => setFormWins(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Sconfitte" value={formLosses} onChange={e => setFormLosses(e.target.value)} style={inputStyle} />
          <input type="number" placeholder="Pareggi" value={formDraws} onChange={e => setFormDraws(e.target.value)} style={inputStyle} />
        </div>
        <Btn primary onClick={addLegacy} style={{ width: '100%' }}>Aggiungi</Btn>

        {legacyEntries.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <button onClick={() => setShowLegacy(s => !s)}
            style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
              background: '#f5f5f5', border: '0.5px solid #e0e0e0', borderRadius: 8,
              padding: '8px 12px', cursor: 'pointer', fontSize: 12, fontWeight: 500,
              color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em'
            }}>
            <span>Voci storiche inserite ({legacyEntries.length})</span>
            <span>{showLegacy ? '▲' : '▼'}</span>
          </button>
          {showLegacy && (
            <div style={{ marginTop: 8 }}>
              {legacyEntries.map(e => (
                <Row key={e.id}>
                  <div>
                    <div style={{ fontWeight: 500 }}>{e.player_name}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>Sett. {e.week_start} · {e.pts}pt · {e.wins}W-{e.losses}L-{e.draws}D</div>
                  </div>
                  <Btn sm danger onClick={() => deleteLegacy(e.id)}>✕</Btn>
                </Row>
              ))}
            </div>
          )}
        </div>
      )}
      </Card>

      <Card title="Winrate mazzi" extra={
        <select value={deckFilter} onChange={e => setDeckFilter(e.target.value)}
          style={{ fontSize: 12, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc' }}>
          <option value="top">Più giocati (&gt;4 round)</option>
          <option value="low">Meno giocati (≤4 round)</option>
          <option value="all">Tutti</option>
        </select>
      }>
        {visibleDecks.length === 0 ? <Empty /> : visibleDecks.slice(0, deckFilter === 'all' ? 100 : 10).map(d => (
          <div key={d.deck} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid #f0f0f0', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renamingDeck === d.deck ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={renameValue} onChange={e => setRenameValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmRename()}
                    autoFocus
                    style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }} />
                  <Btn sm success onClick={confirmRename}>✓</Btn>
                  <Btn sm onClick={() => setRenamingDeck(null)}>✕</Btn>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {d.deck}
                    <button onClick={() => startRename(d.deck)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 6, color: '#999', fontSize: 12 }}>
                      ✎
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#666' }}>{d.games} rounds</div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'right', minWidth: 70 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#534AB7' }}>
                {d.games > 0 ? (d.wins / d.games * 100).toFixed(0) + '%' : '—'}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#f0f0f0', marginTop: 4, width: 70 }}>
                <div style={{ height: '100%', borderRadius: 2, background: '#534AB7', width: d.games > 0 ? (d.wins / d.games * 100) + '%' : '0%' }} />
              </div>
            </div>
          </div>
        ))}
      </Card>
      
      <Card title="Statistiche giocatori">
        {playerStats.length === 0 ? <Empty /> : playerStats.map(p => (
          <div key={p.name} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '0.5px solid #f0f0f0', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {renamingPlayer === p.name ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  <input value={renamePlayerValue} onChange={e => setRenamePlayerValue(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && confirmRenamePlayer()}
                    autoFocus
                    style={{ flex: 1, padding: '4px 8px', borderRadius: 6, border: '0.5px solid #ccc', fontSize: 13 }} />
                  <Btn sm success onClick={confirmRenamePlayer}>✓</Btn>
                  <Btn sm onClick={() => setRenamingPlayer(null)}>✕</Btn>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>
                    {p.name}
                    <button onClick={() => startRenamePlayer(p.name)}
                      style={{ border: 'none', background: 'none', cursor: 'pointer', marginLeft: 6, color: '#999', fontSize: 12 }}>
                      ✎
                    </button>
                  </div>
                  <div style={{ fontSize: 11, color: '#666' }}>{p.games} rounds · {p.tournaments} tornei · {p.pts}pt totali</div>
                </>
              )}
            </div>
            <div style={{ textAlign: 'right', minWidth: 70 }}>
              <div style={{ fontSize: 15, fontWeight: 500, color: '#534AB7' }}>
                {p.games > 0 ? (p.wins / p.games * 100).toFixed(0) + '%' : '—'}
              </div>
              <div style={{ height: 4, borderRadius: 2, background: '#f0f0f0', marginTop: 4, width: 70 }}>
                <div style={{ height: '100%', borderRadius: 2, background: '#534AB7', width: p.games > 0 ? (p.wins / p.games * 100) + '%' : '0%' }} />
              </div>
            </div>
          </div>
        ))}
      </Card>
      <Card title="Storico tornei">
        {history.length === 0 ? <Empty /> : history.slice(0, 8).map(t => (
          <Row key={t.id}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 500 }}>{t.name}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{t.date} · {t.rounds} round</div>
            </div>
          </Row>
        ))}
      </Card>
      <Card title="Backup dati">
      <p style={{ fontSize: 13, color: '#666', marginBottom: 12 }}>
        Esporta tutti i dati (tornei, risultati, classifica) in un file JSON da tenere offline.
        In caso di perdita del database, puoi reimportarlo qui.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <Btn success onClick={exportAll}>
          ⬇ Esporta backup
        </Btn>
        <label style={{
          padding: '8px 16px', borderRadius: 8, border: '0.5px solid #ccc',
          fontSize: 13, fontWeight: 500, cursor: 'pointer', color: '#1a1a1a',
          background: 'none', whiteSpace: 'nowrap'
        }}>
          ⬆ Importa backup
          <input type="file" accept=".json" style={{ display: 'none' }} onChange={importAll} />
        </label>
      </div>
    </Card>
    </div>
  )
}

// ---- SHARED COMPONENTS ----
function Card({ title, extra, children }) {
  return (
    <div style={{ background: 'white', borderRadius: 12, border: '0.5px solid #e0e0e0', padding: 16, marginBottom: 12 }}>
      {(title || extra) && (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          {title && <div style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</div>}
          {extra}
        </div>
      )}
      {children}
    </div>
  )
}

function Row({ children }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '0.5px solid #f5f5f5' }}>{children}</div>
}

function Btn({ children, onClick, primary, danger, success, sm, style }) {
  const bg = primary ? '#3C3489' : danger ? '#A32D2D' : success ? '#0F6E56' : 'none'
  const color = (primary || danger || success) ? '#fff' : '#1a1a1a'
  return (
    <button onClick={onClick} style={{
      padding: sm ? '5px 10px' : '8px 16px', borderRadius: 8,
      border: `0.5px solid ${primary ? '#3C3489' : danger ? '#A32D2D' : success ? '#0F6E56' : '#ccc'}`,
      background: bg, color, fontSize: sm ? 12 : 13, fontWeight: 500,
      cursor: 'pointer', whiteSpace: 'nowrap', ...style
    }}>{children}</button>
  )
}

function Empty() {
  return <div style={{ textAlign: 'center', padding: '24px 0', color: '#999', fontSize: 13 }}>Nessun dato ancora.</div>
}