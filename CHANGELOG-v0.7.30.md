# Turkey Bowling v0.7.30

- Fixed the host Class Matchups initial-position race that could preserve `scrollLeft = 0` before the intended Championship focus completed.
- Added stale-render protection for delayed carousel callbacks.
- Host OPT OUT / OPT IN resets the overview focus so the next host matchup view opens on Championship.
- Audited matchup identity handling; no player-name/server change was required because active reconnects preserve the same player ID and name.
- No gameplay, scoring, physics, matchmaking, maths, spectator or server behavior changed.
