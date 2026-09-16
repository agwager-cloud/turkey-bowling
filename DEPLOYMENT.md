# Turkey Bowling v0.7.35 Deployment

v0.7.35 is a **client-only cosmetic hotfix**. There are no server code changes from v0.7.34.

## itch.io

Upload the supplied v0.7.35 itch ZIP as the HTML5 build. `index.html` is at the ZIP root.

## GitHub

Apply the v0.7.35 GitHub hotfix over the existing repository, commit the changed client/release files, and push to `main`.

## Render

No Render redeploy is required for v0.7.35 because `server/` is unchanged. If Render is configured with `rootDir: server`, it is normal for this GitHub push not to trigger a new server deployment.
