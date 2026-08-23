# Turkey Bowling v0.7.27

**Head-pin graze + skittle physics refinement built directly on the recovered/stable v0.7.26 client.**

- Fixes the v0.7.26 binary head-pin behaviour: a clear miss keeps pin 1 standing, while a genuine edge clip now knocks it down.
- Uses a stricter near-real head-pin contact radius so a ball that is visibly clear of pin 1 cannot magically score it.
- Resolves real swept ball/pin contacts before the adjacent-gap fallback, so a visible graze can never be pre-emptively turned into a protected miss.
- Uses the first swept time-of-impact normal instead of the closest-point normal; glancing hits now transfer meaningful forward/lateral energy instead of feeling dead.
- Preserves more bowling-ball forward momentum through the pocket, preventing the ball from appearing to stop behind the head pin while back-row pins fall.
- Strengthens deterministic lateral skittle/messenger carry for thin hits and horizontal fallen pins.
- Retains the v0.7.26 rare 7-10 tuning and the recovered host OPT OUT, shot/match ID sync protection, spectator behaviour, gutter `awww` and spare audio.

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
