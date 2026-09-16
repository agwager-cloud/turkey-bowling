# Turkey Bowling v0.7.33 Deployment

## GitHub / Render
The v0.7.33 live-scoreboard and spectator-animation hotfix is client-side. The existing Turkey Bowling server source is unchanged.

Push the updated client/source files to GitHub. If Render is configured with `rootDir: server`, it is normal for the Turkey Bowling server **not** to redeploy for this release because there are no server changes.

## itch.io
Upload the supplied v0.7.33 itch ZIP as the HTML5 build. `index.html` is at the ZIP root.

## Validation
Run:

```powershell
npm install
npm run verify:critical
npm run typecheck
npm run build
```
