# Turkey Bowling v0.7.35

Classroom multiplayer bowling game for itch.io with a Node server.

## v0.7.35 cosmetic hotfix

- Widened the host Matchups **Live Scoreboard** so the complete rounded player-row border remains visible.
- Added safer horizontal padding and disabled horizontal clipping/scrolling inside the scoreboard list.
- Preserved Current Score / Frame / PB / Wins and the clickable Score / PB / Wins sorting from v0.7.34.
- Preserved the full spectator bowl replay and host participation focus behaviour from earlier releases.
- Client-only change: the server remains v0.7.34 and does not need a Render redeploy.

See `CHANGELOG-v0.7.35.md` for this release and `DEPLOYMENT.md` for deployment steps.


## v0.7.36 host-turn safety
Participating hosts may inspect Class Matchups during the opponent turn. When their own shot clock or score check becomes active, the client automatically returns them to their lane. Class Matchups is disabled during an active host turn, and live board errors use non-blocking toasts rather than browser alerts.


### v0.7.37 turn-clock safety
The active bowler now acknowledges that their lane controls are rendered before the authoritative 15-second clock is refreshed. This prevents an unseen timeout during opponent-to-player handoff on a slower host/client device.
