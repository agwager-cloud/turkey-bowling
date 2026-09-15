# Turkey Bowling v0.7.32 Deployment

## GitHub / Render
The v0.7.32 gameplay hotfix is client-side. The existing Turkey Bowling server code remains unchanged. Push the repaired repository so GitHub contains the correct Turkey source.

## itch.io
Upload the supplied v0.7.32 itch ZIP as the HTML5 build. `index.html` is at the ZIP root.

## Validation
Run:

```powershell
npm install
npm run verify:critical
npm run typecheck
npm run build
```
