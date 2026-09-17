# Turkey Bowling v0.7.37 — Rendered Turn Clock Fix

## Fixed
- Corrects a player-turn handoff race that could score an unseen 0-pin timeout when the next bowler's client had not finished rendering their lane yet.
- Adds a `turn_ready` handshake. The real 15-second shot clock is refreshed only after the active player's bowling controls are actually on screen.
- Keeps a 30-second server fail-safe before readiness so a connected-but-broken client still cannot stall a class indefinitely.
- The visible clock still gives exactly 15 seconds from the moment the controls appear.
- Preserves the v0.7.36 safeguards that stop a participating host from sitting in Class Matchups during their own active turn and removes blocking Matchups alerts.

## Investigation note
- A normal student opponent cannot remain in Class Matchups during an active match, and their navigation cannot directly record a zero for the host.
- v0.7.36 alone targeted the host leaving the lane. v0.7.37 additionally protects the lane-to-lane turn handoff when the host/player never leaves BowlingScene.

## Deployment
This release changes both client and server. Push GitHub/Render first, wait for the Turkey Bowling server to deploy, then upload the v0.7.37 itch.io ZIP.
