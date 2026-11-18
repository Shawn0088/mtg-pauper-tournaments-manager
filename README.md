# 🛡️ MTG Pauper Tournament Manager

A web app to organize and manage a series of **Pauper** (Magic: The Gathering) tournaments. It acts both as a **live tournament assistant** (pairings, round timer, score input) and as a **long-term stats tracker** (deck winrates, player standings, season leaderboards).


---

## ✨ Features

| Area | What it does |
|---|---|
| **Tournament tab** | Create tournaments, register players & decks, generate Swiss pairings, enter round scores, view live standings, close the tournament |
| **Timer tab** | Synchronized round clock (start/pause/reset/±minutes) shared in real-time across all connected devices via Supabase Realtime; generates a shareable QR code for players |
| **Player view** (`#/play`) | Public page (no password) for players — shows the live timer, their table number for the current round, and the full pairing list; players can also self-register before round 1 |
| **Rankings tab** | Season-filtered cumulative leaderboard with per-week drill-down and a Top-5 bar chart |
| **Stats tab** | Global deck winrates, per-player win rates across all tournaments, tournament history, season management, legacy score import, and full JSON backup/restore |

---

## 🗺️ Architecture overview

```
src/
├── main.jsx              # React entry point
├── supabase.js           # Supabase client (reads env vars)
├── swiss.js              # Pure Swiss-pairing & standings logic
├── App.jsx               # All UI components (single-file, ~1 500 lines)
├── hooks/
│   ├── useTournament.js  # All tournament CRUD operations
│   └── useTimer.js       # Realtime-synced round timer
└── assets/
    └── hero.png
```

### Database tables (Supabase / PostgreSQL)

| Table | Key columns | Purpose |
|---|---|---|
| `tournaments` | `id`, `name`, `date`, `rounds`, `finished` | One row per tournament |
| `entries` | `tournament_id`, `player_name`, `deck` | Players registered for a tournament |
| `results` | `tournament_id`, `round`, `p1`, `p2`, `s1`, `s2`, `bye` | One row per match (or bye) |
| `leaderboard` | `tournament_id`, `player_name`, `week_start`, `pts`, `wins`, `losses`, `draws`, `deck` | Denormalised standings written at tournament close |
| `seasons` | `name`, `start_date`, `end_date`, `active` | Named time windows for filtering the leaderboard |
| `timer` | `id=1`, `remaining_sec`, `total_sec`, `running`, `started_at` | Single shared row for the round timer |

---

## 🔑 Key code modules

### `src/swiss.js` — Swiss pairing engine

**`calcStandings(players, results)`**
Computes a full standings object for every player: points (W=3, D=1, L=0), Opponent Match-Win % (OMW), Game-Win % (GWP), and Opponent Game-Win % (OGW) — the four standard MTG tiebreakers.  
All percentages are floored at 1/3 (33 %) as per WotC tournament rules.

**`swissPair(players, results, roundNum)`**
Generates pairings for the next round:
1. On round 1 the standings are shuffled randomly.
2. A bye is assigned to the lowest-ranked player who hasn't had one yet (if there's the need to assign a bye).
3. A **full backtracking** algorithm (`tryPairNoRematch`) pairs players top-down avoiding rematches.
4. If no rematch-free solution exists, a second backtracking pass (`tryPairWithRematch`) allows rematches as a last resort.

**`getWeekStart(dateStr)`**
Returns the Monday of the week containing a given date (used to group tournaments by calendar week in the leaderboard).

---

### `src/hooks/useTournament.js` — Tournament state & CRUD

A custom React hook that owns all tournament data and exposes:

| Function | What it does |
|---|---|
| `createTournament(name)` | Inserts a new tournament row |
| `addEntry / removeEntry / updateEntryDeck` | Manage the player roster |
| `startRound(tournamentId)` | Calls `swissPair`, bulk-inserts the pairings, and bumps the round counter |
| `submitResult(id, s1, s2)` | Updates a match score |
| `rewindToRound(tournamentId, n)` | Deletes all rounds after `n`, resets `finished=false`, and clears leaderboard entries for that tournament |
| `finishTournament(tournamentId)` | Runs final standings, upserts rows into `leaderboard`, sets `finished=true` |
| `swapPlayers(...)` | Swaps two player slots across different pairings (used by the drag-and-drop editor) |
| `renamePlayer(...)` | Updates a player's name in `entries`, `results`, and `leaderboard` |
| `deleteTournament(id)` | Deletes a tournament and cascades cleanup |

---

### `src/hooks/useTimer.js` — Realtime round timer

- Loads the current timer state from the `timer` table on mount.
- Subscribes to Supabase Realtime `postgres_changes` on that table so every connected device (judge screen, player phones) stays in sync automatically.
- Runs a local `setInterval` tick for smooth per-second countdown without hammering the database.
- Writes back to Supabase only on explicit actions: `start`, `pause`, `reset`, `addTime`.

---

### `src/App.jsx` — UI

Five React components rendered by the top-level `App`:

| Component | Route / tab |
|---|---|
| `PlayerView` | `#/play` — public player page |
| `TournamentTab` | Admin: tournament management |
| `TimerTab` | Admin: timer controls + QR share |
| `StandingsTab` | Admin: season leaderboard |
| `DatabaseTab` | Admin: stats, seasons, backup |

Shared primitives: `Card`, `Row`, `Btn`, `Empty`, `DraggableName`, `DroppableSlot`, `ScoreSelect`.

The admin area is protected by a client-side password stored in `sessionStorage`. The password is read from the `VITE_ADMIN_PASSWORD` environment variable (see [Security](#-security) below).

The player view (`#/play`) is intentionally **public** — players scan a QR code to reach it.

---

## 🛠️ Tech stack

| Layer | Technology |
|---|---|
| Frontend | [React](https://react.dev/) 19 + [Vite](https://vite.dev/) 8 |
| Database & Realtime | [Supabase](https://supabase.com/) (PostgreSQL + Supabase Realtime) |
| Charts | [Chart.js](https://www.chartjs.org/) via `react-chartjs-2` |
| Drag & drop | [dnd-kit](https://dndkit.com/) |
| Deployment | [Vercel](https://vercel.com/) |

---

## 🚀 Getting started

### Prerequisites

- **Node.js** ≥ 18 (LTS recommended)
- A **Supabase** project (free tier is enough)

### 1 — Clone & install

```bash
git clone https://github.com/Shawn0088/mtg-pauper-tournaments-manager.git
cd mtg-pauper
npm install
```

### 2 — Set up Supabase

1. Create a new project at [supabase.com](https://supabase.com).
2. Run the SQL below in the **SQL editor** to create all required tables:

<details>
<summary>Show SQL schema</summary>

```sql
create table tournaments (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  date date not null,
  rounds int not null default 0,
  finished boolean not null default false,
  created_at timestamptz not null default now()
);

create table entries (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  player_name text not null,
  deck text not null default 'Unknown'
);

create table results (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete cascade,
  round int not null,
  p1 text not null,
  p2 text,
  s1 int not null default 0,
  s2 int not null default 0,
  bye boolean not null default false
);

create table leaderboard (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid references tournaments(id) on delete set null,
  player_name text not null,
  week_start date not null,
  pts int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  draws int not null default 0,
  deck text not null default 'Unknown'
);

create table seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  start_date date not null,
  end_date date not null,
  active boolean not null default false
);

-- Single-row timer (insert once)
create table timer (
  id int primary key,
  remaining_sec int not null default 3000,
  total_sec int not null default 3000,
  running boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz
);
insert into timer (id) values (1);
```

</details>

3. Enable **Realtime** for the `timer` table: in Supabase go to **Database → Replication** and add the `timer` table to the realtime publication.

### 3 — Configure environment variables

Copy `.env.example` to `.env` and fill in your values:

```bash
cp .env.example .env
```

```env
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key_here
VITE_ADMIN_PASSWORD=choose_a_strong_password
```

Find the URL and anon key in your Supabase project under **Settings → API**.

### 4 — Run locally

```bash
npm run dev
```

The app will be available at `http://localhost:5173`.

---

## 📦 Available scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the Vite development server |
| `npm run build` | Create an optimised production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | Run ESLint |

---

## ☁️ Deploy to Vercel

1. Push the repo to GitHub.
2. Import the project in [Vercel](https://vercel.com/new).
3. Add the three environment variables (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ADMIN_PASSWORD`) in **Project → Settings → Environment Variables**.
4. Deploy — Vercel auto-detects Vite and sets the build command to `npm run build`.

---

## 🔒 Security

> [!IMPORTANT]
> **The admin password is a client-side protection only.** Anyone with access to the browser DevTools can bypass it. Do **not** rely on it to protect sensitive personal data. It is intended to prevent casual interference during a local tournament night.

**Before making the repository public, verify:**

- [ ] `.env` is listed in `.gitignore` ✅ (already configured)
- [ ] The `VITE_ADMIN_PASSWORD` variable is **not** hardcoded in source — it is read from the environment ✅ (fixed in this version)
- [ ] The Supabase `anon` key is safe to expose — it is designed to be public and access is controlled by **Row Level Security (RLS)** policies in Supabase
- [ ] Review your Supabase RLS policies and restrict write access as needed for your use case

**Supabase `anon` key note:** The `VITE_SUPABASE_ANON_KEY` is intentionally visible in the browser bundle. Supabase's security model relies on RLS policies server-side, not on keeping the anon key secret. See [Supabase docs on API keys](https://supabase.com/docs/guides/api/api-keys).

---

## 🗂️ Project structure

```
mtg-pauper/
├── public/
│   ├── favicon.svg
│   └── icons.svg
├── src/
│   ├── assets/
│   │   └── hero.png
│   ├── hooks/
│   │   ├── useTournament.js   # Tournament CRUD hook
│   │   └── useTimer.js        # Realtime timer hook
│   ├── App.jsx                # All UI components
│   ├── App.css
│   ├── index.css
│   ├── main.jsx
│   └── supabase.js            # Supabase client initialisation
├── .env.example               # Environment variable template
├── .gitignore
├── eslint.config.js
├── index.html
├── package.json
└── vite.config.js
```

---

## 📄 License

This project is released under the **MIT License** — see [LICENSE](LICENSE) for details.

> Magic: The Gathering and Pauper are trademarks of Wizards of the Coast LLC. This project is an unofficial fan tool and is not affiliated with or endorsed by Wizards of the Coast.
