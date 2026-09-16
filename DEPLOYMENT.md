# Turkey Bowling v0.7.34 Deployment

v0.7.34 changes both the client and server.

## 1. GitHub / Render
Apply the supplied GitHub hotfix over the Turkey Bowling repository, commit, and push to `main`.
Because `server/src/index.ts` and `server/package.json` change in this release, Render should automatically redeploy `turkey-bowling-server` when its Root Directory is `server`.

Wait until Render shows the Turkey Bowling service as **Deployed** on the new commit before classroom testing.

## 2. itch.io
Upload the supplied v0.7.34 itch ZIP as the HTML5 build. `index.html` is at the ZIP root.

## 3. Quick test
Complete one 10-frame game, confirm PB remains on the next matchup, then click SCORE, PB and WINS on the host leaderboard and confirm each sorts highest-to-lowest.
