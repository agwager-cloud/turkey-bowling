# Turkey Bowling v0.7.32

## Matchups focus
- Restored the v0.7.31 host-focus rule to GitHub source: participating hosts focus their own lane; opted-out hosts focus Championship.
- Added a stable focus key so ordinary `bowling_state` updates do not tug the Matchups carousel to another lane.

## Spectator result
- Replaced the 1.35-second generic spectator completion message with a dedicated winner/score result.
- Normal matches show both final scores.
- Bowl-Off matches show the regulation score plus the deciding Bowl-Off round.
- Forfeits are labelled clearly and show the score at stoppage.
- Result remains visible until the spectator chooses Return to Matchups.
- `round_complete` now preserves the watched result instead of immediately navigating away.

## Source repair
- Repaired Turkey Bowling's `client/src/main.ts`, root/client package metadata, package lock and project documentation after Dodeca-Gems v1.0.13 files had been mixed into the GitHub source ZIP.
- No Turkey Bowling server gameplay/scoring changes were required for this hotfix.
