# MH Wilds Hunt Dashboard

Second-screen dashboard for Monster Hunter Wilds (spec: [HANDOFF.md](HANDOFF.md), mockup: [Main.dc.html](Main.dc.html)).

```
[MH Wilds + REFramework] lua/…/hunt_dashboard.lua → reframework/data/hunt_dashboard.json (every 200ms, read-only)
        ↓ bridge/server.js polls the file
[ws://127.0.0.1:8787] → [Vite + React + Tailwind UI]
```

## Use (portable exe)

1. Install the two game mods yourself, once: **REFramework** ([releases](https://github.com/praydog/REFramework-nightly/releases), `dinput8.dll` into the game folder) and **_CatLib** (Nexus Mods, comes with MHWilds Overlay).
2. Run `HuntDashboard-<version>-portable.exe`. On every start it finds the game, copies/updates its own Lua script into `reframework/autorun`, and shows a banner if REFramework or _CatLib is missing (with links and a "check again" button). Status is also in settings (S).
3. If the script was updated while the game was running: REFramework menu → ScriptRunner → Reset scripts.

After a game update REFramework usually needs updating too.

## Run from source

```bash
npm install
npm run install-lua   # copies the Lua script into <game>/reframework/autorun (needs _CatLib, comes with MHWilds Overlay)
npm run dev           # UI on http://127.0.0.1:5173 + bridge on ws://127.0.0.1:8787
```

Open the page on the second monitor and press F11 — or run it as a desktop app:

```bash
npm run app       # builds the UI, opens a borderless window on the second monitor (bridge included)
npm run app:dev   # same window, but showing the running dev server
npm run dist      # package it: release/HuntDashboard-<version>-portable.exe (single file, no install)
```

The app window remembers its position, never takes focus from the game, F11 = fullscreen, Alt+F4 closes, drag it by the header.
Press **S** (or the gear button) for settings: bridge port, size, alert sounds, which panels to show. After a quest ends the dashboard shows a hunt summary (time, damage, DPS chart, crit and weak-spot rates, buff uptime); the last 50 hunts are kept and can be flipped through with the strip below it or ←/→. Damage includes palicos (own row under their hunter); mantles show their cooldown.

**Discord Rich Presence** (desktop app): create an application at discord.com/developers, then put its Application ID in settings (S) → Discord. Line 1 shows your HR and weapon, line 2 what is happening (hunting / enraged / ailment / capturable, with a small colored badge) and is also what friends see in the member list; quest timer and a link to this repo. Badges and icon are `build/*.png` from this repo (`npm run icon` re-renders them from the SVGs). After editing Lua in game: REFramework menu → ScriptRunner → Reset scripts.

Game folder is found from Steam's `libraryfolders.vdf`; override with `MHW_GAME_DIR`.

## Without the game

- Mock states: `http://127.0.0.1:5173/?mock=capture` (bar at the top lists all states)
- Record a real hunt: `npm run bridge -- --record hunt.jsonl` (with `BRIDGE=off npm run dev`)
- Replay it: `npm run bridge -- --replay hunt.jsonl`

## Layout

- `lua/reframework/autorun/hunt_dashboard/game_reader.lua` — the only file that knows game field names
- `bridge/` — file → WebSocket, localhost only, offline after 3s without updates
- `src/logic.ts` — data contract + all derived values (`npm test`)
- `src/App.tsx` — UI · `src/strings.ts` — text · `src/icons.tsx` — icons · `src/mocks.ts` — mock states

