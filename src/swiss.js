export function calcStandings(players, results) {
  const pts = {}, wins = {}, losses = {}, draws = {}, gw = {}, gl = {}
  players.forEach(p => {
    pts[p] = 0; wins[p] = 0; losses[p] = 0
    draws[p] = 0; gw[p] = 0; gl[p] = 0
  })

  results.forEach(r => {
    if (r.bye) {
      pts[r.p1] += 3; wins[r.p1]++
      gw[r.p1] += 2
      return
    }
    const [a, b] = [r.s1, r.s2]
    gw[r.p1] += a; gl[r.p1] += b
    gw[r.p2] += b; gl[r.p2] += a
    if (a > b)      { pts[r.p1] += 3; wins[r.p1]++; losses[r.p2]++ }
    else if (b > a) { pts[r.p2] += 3; wins[r.p2]++; losses[r.p1]++ }
    else            { pts[r.p1]++; pts[r.p2]++; draws[r.p1]++; draws[r.p2]++ }
  })

  const mwp = id => {
    const t = wins[id] + losses[id] + draws[id]
    return t ? Math.max(wins[id] / t, 1 / 3) : 1 / 3
  }

  const gwp = id => {
    const totalGames = gw[id] + gl[id]
    return totalGames ? Math.max(gw[id] / totalGames, 1 / 3) : 1 / 3
  }

  const omw = id => {
    const ops = results
      .filter(r => !r.bye && (r.p1 === id || r.p2 === id))
      .map(r => r.p1 === id ? r.p2 : r.p1)
    if (!ops.length) return 0
    return ops.reduce((s, o) => s + mwp(o), 0) / ops.length
  }

  const ogw = id => {
    const ops = results
      .filter(r => !r.bye && (r.p1 === id || r.p2 === id))
      .map(r => r.p1 === id ? r.p2 : r.p1)
    if (!ops.length) return 0
    return ops.reduce((s, o) => s + gwp(o), 0) / ops.length
  }

  return players
    .map(p => ({
      name: p,
      pts: pts[p] || 0,
      wins: wins[p] || 0,
      losses: losses[p] || 0,
      draws: draws[p] || 0,
      gw: gw[p] || 0,
      gl: gl[p] || 0,
      omw: omw(p),
      gwp: gwp(p),
      ogw: ogw(p)
    }))
    .sort((a, b) =>
      b.pts - a.pts ||
      b.omw - a.omw ||
      b.gwp - a.gwp ||
      b.ogw - a.ogw
    )
}

export function swissPair(players, results, roundNum) {
  let standings = calcStandings(players, results)

  if (roundNum === 1) {
    standings = [...standings].sort(() => Math.random() - 0.5)
  }

  const played = (a, b) =>
    results.some(r =>
      !r.bye && ((r.p1 === a && r.p2 === b) || (r.p1 === b && r.p2 === a))
    )

  const hadBye = (name) =>
    results.some(r => r.bye && r.p1 === name)

  let pool = [...standings]
  const pairings = []

  // Gestione bye con backtracking completo
  if (pool.length % 2 === 1) {
    // cerca dal fondo il primo senza bye
    let byeIndex = -1
    for (let i = pool.length - 1; i >= 0; i--) {
      if (!hadBye(pool[i].name)) { byeIndex = i; break }
    }
    if (byeIndex === -1) byeIndex = pool.length - 1
    const byePlayer = pool[byeIndex]
    pairings.push({ p1: byePlayer.name, p2: null, bye: true, s1: 2, s2: 0, round: roundNum })
    pool = pool.filter((_, i) => i !== byeIndex)
  }

  // Backtracking completo senza rimatch
  const tryPairNoRematch = (list) => {
    if (list.length === 0) return true
    const a = list[0]
    const rest = list.slice(1)
    for (let i = 0; i < rest.length; i++) {
      if (!played(a.name, rest[i].name)) {
        pairings.push({ p1: a.name, p2: rest[i].name, bye: false, s1: 0, s2: 0, round: roundNum })
        const remaining = rest.filter((_, j) => j !== i)
        if (tryPairNoRematch(remaining)) return true
        pairings.pop()
      }
    }
    return false
  }

  // Backtracking con rimatch come fallback (solo se necessario)
  const tryPairWithRematch = (list) => {
    if (list.length === 0) return true
    const a = list[0]
    const rest = list.slice(1)
    for (let i = 0; i < rest.length; i++) {
      pairings.push({ p1: a.name, p2: rest[i].name, bye: false, s1: 0, s2: 0, round: roundNum })
      const remaining = rest.filter((_, j) => j !== i)
      if (tryPairWithRematch(remaining)) return true
      pairings.pop()
    }
    return false
  }

  // Prova prima senza rimatch, poi cede al fallback solo se necessario
  if (!tryPairNoRematch(pool)) {
    tryPairWithRematch(pool)
  }

  return pairings
}

export function getWeekStart(dateStr) {
  const d = new Date(dateStr)
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}