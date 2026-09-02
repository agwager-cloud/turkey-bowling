# Dodeca-Gems v1.0.13

## Host matchup focus + round handoff

- Participating hosts now focus their own court on the Matchups screen, even when that court is left of Championship.
- Opted-out hosts focus the far-right Championship court.
- The carousel focus target changes only when the host pairing/participation target changes, preventing room-state updates from tugging the view between two courts.
- A host's manual “View Matchups” choice is now tied to the current match ID. When a new host pairing is created, the old overview mode expires and the new game takes priority automatically.
- Manual scrolling is still preserved for the duration of the same pairing.
- No server, scoring, ladder-routing or game-rule logic changed in v1.0.13.
