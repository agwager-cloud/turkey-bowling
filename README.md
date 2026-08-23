# Turkey Bowling v0.6.2 — Production Endpoint Locked

Multiplayer ten-pin bowling maths game built with Phaser/Vite on the client and Node.js/WebSockets on the server.

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

The finished file will be created at `releases\turkey-bowling-itch-v0.6.2.zip`, with `index.html` at the ZIP root.
