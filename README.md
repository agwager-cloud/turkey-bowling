# Turkey Bowling v0.7.32

Turkey Bowling is a classroom multiplayer ten-pin bowling game with a live King-of-the-Court ladder, host opt-in/opt-out controls, live spectating, score verification and maths checks.

## v0.7.32 hotfix

- Participating host Matchups focus follows the host's own lane.
- Opted-out host Matchups focus defaults to the right-most Championship lane.
- Focus is keyed to the current pairing/participation state so live updates do not drag the carousel away from the intended lane.
- Spectators now receive a clear end-of-match winner and score result instead of a brief generic `MATCH COMPLETE` message.
- The spectator result remains visible until Return to Matchups is selected, and the class `round_complete` event no longer cuts it off.
- The GitHub client entry point/package metadata were repaired after Dodeca-Gems files had been mixed into the Turkey Bowling source tree.

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
