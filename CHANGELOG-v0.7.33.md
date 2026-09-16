# Turkey Bowling v0.7.33

## Host Matchups live scoreboard
- Replaces the wins-only side panel with a live class scoreboard.
- Shows every player's current bowling score, current frame and match wins.
- Sorts active bowlers by current score descending, then frame, wins and lane as tie-breakers.
- Keeps inactive/opted-out players visible with a dash and bye players clearly identified.

## Spectator full-bowl replay
- Prevents `bowling_state` / round state updates from rebuilding the spectator canvas while a seeded bowl is still animating.
- Queues any following spectator shot instead of interrupting the current one.
- Holds the settled rack for 700 ms so the ball impact and pins falling are visible before the score/frame UI refreshes.
- Continues to use the exact player shot inputs and deterministic seed, preserving the real trajectory and pin physics.
- Defers next-round/final navigation until the current visible delivery finishes.

## Preserved
- Participating host focuses their own lane.
- Opted-out host focuses the right-most Championship lane.
- v0.7.32 persistent spectator winner/score result screen.
