# Turkey Bowling v0.7.34

## Host Live Scoreboard
- Added a persistent **PB** column showing each player's best official completed 10-frame score for the current class session.
- PB uses the final adjusted score after any Level 2/3 maths timeout penalties and is not recorded until the game and required score checks are complete.
- Added clickable **SCORE**, **PB**, and **WINS** headings.
- Clicking a heading immediately sorts the leaderboard highest-to-lowest by that measure.
- Current Score remains the default sort and Frame remains visible alongside it.
- Sort selection survives normal live score/state updates while the host remains on the Matchups screen.

## Server
- Added `personalBestScore` to the player state sent to clients.
- PB is retained across successive bowling matches in the same session and resets with the existing class reset / Return to Lobby flow.

## Preserved
- v0.7.33 uninterrupted full spectator bowl replay.
- v0.7.32 participating-host own-lane focus and opted-out-host Championship focus.
- Persistent spectator winner/score result screen.
