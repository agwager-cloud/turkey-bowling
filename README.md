# Turkey Bowling v0.7.33

Turkey Bowling is a classroom multiplayer ten-pin bowling game with a live King-of-the-Court ladder, host opt-in/opt-out controls, live spectating, score verification and maths checks.

## v0.7.33 hotfix

- Host Matchups now includes a **Live Scoreboard** showing every player's current bowling score, current frame and match wins.
- Active players are ranked by current bowling score from highest to lowest, with frame/wins/lane used as tie-breakers.
- Opted-out/inactive players remain visible so the host can still account for the whole class.
- Live spectator bowling now protects the deterministic shot animation from incoming state re-renders.
- Spectators see the entire seeded trajectory, ball impact and pin action, followed by a short settled-rack hold before the authoritative score/frame UI refreshes.
- If the host device is temporarily slower than the players, subsequent spectator shots are queued rather than interrupting the bowl already on screen.
- Participating-host → own lane and opted-out-host → Championship focus from v0.7.32 is preserved.
- Persistent spectator winner/score results from v0.7.32 are preserved.

## Local development

Node.js 20–23 is supported.

```powershell
npm install
npm run dev
```

Client: `http://localhost:5173`
Server: `ws://localhost:8080`

## Production server

The client connects to the Turkey Bowling Render WebSocket service configured in `client/src/net/NetworkManager.ts`.
