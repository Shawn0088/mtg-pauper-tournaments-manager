import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'

export function useTimer() {
  const [remaining, setRemaining] = useState(3000)
  const [totalSec, setTotalSec] = useState(3000)
  const [running, setRunning] = useState(false)
  const intervalRef = useRef(null)
  const lastTickRef = useRef(null)

  // Carica stato iniziale da Supabase
  useEffect(() => {
    supabase.from('timer').select('*').eq('id', 1).single().then(({ data }) => {
      if (!data) return
      setTotalSec(data.total_sec)
      if (data.running && data.started_at) {
        const elapsed = Math.floor((Date.now() - new Date(data.started_at).getTime()) / 1000)
        setRemaining(Math.max(0, data.remaining_sec - elapsed))
      } else {
        setRemaining(data.remaining_sec)
      }
      setRunning(data.running)
    })
  }, [])

  // Realtime sync da altri dispositivi
  useEffect(() => {
    const channel = supabase
      .channel('timer-sync')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'timer' }, payload => {
        const d = payload.new
        setTotalSec(d.total_sec)
        if (d.running && d.started_at) {
          const elapsed = Math.floor((Date.now() - new Date(d.started_at).getTime()) / 1000)
          setRemaining(Math.max(0, d.remaining_sec - elapsed))
        } else {
          setRemaining(d.remaining_sec)
        }
        setRunning(d.running)
      })
      .subscribe()
    return () => supabase.removeChannel(channel)
  }, [])

  // Tick locale
  useEffect(() => {
    if (running) {
      lastTickRef.current = Date.now()
      intervalRef.current = setInterval(() => {
        setRemaining(r => {
          if (r <= 0) { clearInterval(intervalRef.current); return 0 }
          return r - 1
        })
      }, 1000)
    } else {
      clearInterval(intervalRef.current)
    }
    return () => clearInterval(intervalRef.current)
  }, [running])

  const pushToSupabase = async (patch) => {
    await supabase.from('timer').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', 1)
  }

  const start = async () => {
    setRunning(true)
    await pushToSupabase({ running: true, started_at: new Date().toISOString(), remaining_sec: remaining })
  }

  const pause = async () => {
    setRunning(false)
    await pushToSupabase({ running: false, remaining_sec: remaining, started_at: null })
  }

  const reset = async (sec) => {
    const s = sec ?? totalSec
    setRunning(false)
    setRemaining(s)
    setTotalSec(s)
    await pushToSupabase({ running: false, remaining_sec: s, total_sec: s, started_at: null })
  }

  const addTime = async (minutes) => {
    const newRem = remaining + minutes * 60
    const newTot = totalSec + minutes * 60
    setRemaining(newRem)
    setTotalSec(newTot)
    await pushToSupabase({ remaining_sec: newRem, total_sec: newTot })
  }

  return { remaining, totalSec, running, start, pause, reset, addTime }
}