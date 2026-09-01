# Turkey Bowling v0.7.30

**Championship-lane host-view stability fix built on the v0.7.29 gameplay/UI baseline.**

- Fixes the host Class Matchups carousel so the first overview reliably opens on the far-right Championship Lane even when rapid room-state updates arrive during layout.
- Ignores stale carousel callbacks from superseded renders and does not preserve `scrollLeft = 0` before the first real layout completes.
- After OPT OUT / OPT IN, the next host overview is treated as fresh and opens on Championship again.
- Player identity/name logic was audited and intentionally left unchanged because reconnects preserve the same player ID and name correctly.
- No server, bowling physics, scoring, matchmaking, spectator, maths or mini-game logic changed.

## Previous v0.7.29 changes

**1000×720 navigation and maths-layout polish built on the stable v0.7.27 physics/network baseline.**

- Fixes the Match Result **RETURN TO CLASS MATCHUPS** button by stopping the 250 ms countdown timer from rebuilding the entire result DOM. The timer now updates only its number, so mouse/touch navigation cannot be replaced mid-press.
- Keeps the host Class Matchups header controls on **one row** at the standard itch.io 1000×720 landscape embed size.
- Keeps LEVEL, OPT OUT/IN, MANAGE PLAYERS, RETURN TO MY GAME and RETURN TO LOBBY visible without the previous two-row wrap.
- Widens Level 2 Guided Scoring and Level 3 Independent Scoring overlays in landscape.
- Changes the landscape maths keypad from 3×4 to **6×2**, retaining large touch targets while dramatically reducing overlay height.
- Level 3 gets additional width for the 10-frame mini scorecard; standard 1000×720 landscape uses no internal maths-card scrollbar.
- Narrow/portrait devices retain the familiar 3×4 keypad, and very short landscape displays retain scrolling as a safety fallback.
- No bowling physics, multiplayer sync, host opt-out behaviour, spectator flow or audio logic changed in this release.

# Turkey Bowling v0.7.24 — itch.io Packaging Reliability

Multiplayer ten-pin bowling maths game built with Phaser/Vite on the client and Node.js/WebSockets on the server.

## v0.7.23 collision + sound hotfix
- Standing leave pins remain solid collision bodies instead of becoming ghost pins after rack-carry logic runs.
- Added a wider standing-pin contact envelope so the ball cannot visually squeeze through adjacent pins while preserving the slimmer regulation pin artwork.
- Added the zero-pin miss callback expected by the current BowlingScene audio/celebration flow.
- Hardened HTML audio asset resolution for itch.io/local builds.
- Audio now retries on every real user gesture if an embedded browser rejects the first playback attempt.
- One-shot bowling sounds are no longer suppressed forever by a stale internal audio-unlock flag.


## v0.7.24 deployment reliability update
- Keeps Vite production asset URLs explicitly relative for itch.io HTML5 iframe hosting.
- The itch build now verifies every generated JS/CSS asset referenced by `index.html` exists on disk and inside the final ZIP.
- The build fails instead of creating a broken upload if a referenced bundle is missing.
- Server package version synced to v0.7.24 so this commit intentionally triggers one Render deployment despite Render's `server` root-directory filter.

## v0.7.22 bowling feel update
- Tilted the virtual lane camera upward so the taller regulation-proportion pins are fully visible.
- Added an explicit ~6.8 kg bowling ball / ~1.59 kg pin mass ratio for ball-to-pin impacts.
- Reduced ball/pin and pin/pin restitution so collisions feel denser and less springy.
- Reduced scripted rack-kick translation/spin while preserving deterministic scoring and carry.
- Increased fallen-pin deck friction and capped excessive angular speed to remove the lightweight/cartwheel feel.

## Current game
- 10-frame multiplayer bowling with realistic 2.5D ball/pin physics
- Level 1 automatic scoring
- Level 2 guided maths scoring with a 20-second calculation timer
- Level 3 independent scoring with a 30-second calculation timer
- Maths timeout penalties applied to final match scores
- King-of-the-court lane movement and live wins leaderboard
- Live opponent bowling and maths spectating
- Touch-friendly controls for phones/iPads; no software keyboard required for maths
- Music, bowling-alley ambience, pin impact sounds and strike celebrations
- Host return-to-lobby confirmation and player management
- Direct WebSocket connection with no client-side HTTP health-check dependency

## Local development
```powershell
cd C:\Projects\bowling
npm install
npm run dev
```

Local endpoints:
- Client: `http://localhost:5173`
- WebSocket server: `ws://localhost:8080`

## Pre-deployment checks
```powershell
cd C:\Projects\bowling
npm install
npm run typecheck
npm run build
```

## GitHub
The complete project should be committed from the repository root. `node_modules`, `dist`, and local-only env files are ignored. The public production WebSocket endpoint is committed in `client/.env.production`.

## Render server
This repository includes `render.yaml` for the Node WebSocket server. The server:
- uses Render's `PORT` environment variable
- binds to `0.0.0.0`
- accepts WebSocket connections on the same public port as HTTP
- includes WebSocket ping/pong heartbeat handling
- does not require the game client to call `/health` before connecting

Manual Render settings if you do not use the Blueprint:
- Service type: Web Service
- Runtime: Node
- Region: Singapore
- Root Directory: `server`
- Build Command: `npm install && npm run build`
- Start Command: `npm start`
- Instance: Free (or your preferred paid instance)

## itch.io production client
The production WebSocket endpoint is locked to:

`wss://turkey-bowling-server.onrender.com`

It is stored in `client/.env.production`. To build the client and create the correctly structured itch.io ZIP in one command:
```powershell
cd C:\Projects\bowling
npm run build:itch
```

The finished file will be created at `releases\turkey-bowling-itch-v0.7.27.zip`, with `index.html` at the ZIP root.
