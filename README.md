# Dodeca-Gems v1.0.13

Dodeca-Gems is a 12-game multiplayer classroom King-of-the-Court game hub built with Phaser, TypeScript, Vite and a server-authoritative Node/WebSocket backend.

## Games

1. Three Hexagon
2. Four Star
3. Square Boxes
4. Never Touch!
5. Spiral
6. Hex
7. The Factor Game
8. Hedron
9. Multi
10. Ultimate Tic-Tac-Toe
11. Lucky Thirteen
12. Craypots

## Multiplayer systems

- Five-digit rooms and up to 40 connected players
- King-of-the-Court movement and +1 point for every match win
- One crown for the current Championship holder
- Host Manage Players during matchups and games
- Removed names are banned from rejoining that room until changed
- Duplicate-name and duplicate-device protections
- Host OPT OUT / OPT IN from the Matchups screen; opting out of a live match forfeits that match to the opponent
- Gem Bot parity automatically keeps the active ladder even when the host opts in/out
- Late joins and exact server-synchronised live spectating for hosts, waiting players and spectators
- Host Matchups opens on the Championship court and preserves horizontal scroll position during live updates
- Server-authoritative timers and legal-move validation
- Direct secure WebSocket connection for production; no HTTP `/health` wake request

## Local development

Node.js 20+ is recommended.

```powershell
npm install
npm run dev
```

Client: `http://localhost:5173`
Server: `ws://localhost:3001`

## Production

See `DEPLOYMENT.md`.
