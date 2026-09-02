# Dodeca-Gems v1.0.13 Deployment

## Production targets

- Render service name: `dodeca-gems-classroom-server`
- Secure WebSocket endpoint: `wss://dodeca-gems-classroom-server.onrender.com`
- Client: itch.io HTML5
- Source: GitHub

The client connects directly over secure WebSockets. It does **not** make an HTTP `/health` request before connecting.

## GitHub

From the project root:

```powershell
git add .
git commit -m "Dodeca-Gems v1.0.13 - host matchup focus and round handoff"
git push origin main
```

## Render

A `render.yaml` Blueprint is included. Create a Blueprint from the GitHub repository. It creates the Node web service in Singapore using:

```text
Build: npm install && npm run build -w server
Start: npm run start -w server
```

The expected public URL is:

```text
https://dodeca-gems-classroom-server.onrender.com
```

If Render assigns a different hostname, change `VITE_SERVER_URL` in `client/.env.production`, rebuild the client, and create a new itch.io ZIP.

## itch.io

The Vite config uses `base: './'`, so generated asset paths are relative for itch.io hosting.

Build locally from the project root:

```powershell
npm install
npm run build -w client
```

Zip the **contents** of `client/dist` so `index.html` is at the root of the ZIP.

Recommended itch.io settings:

- Project type: HTML
- Mobile friendly: enabled
- Click to launch in fullscreen
- Fullscreen button: enabled

## Release content

1. Three Hexagon
2. Four Star
3. Square Boxes
4. Never Touch!
5. Spiral
6. Hex
7. The Factor Game
8. Hedron
9. Multi
10. Ultimate Tic-Tac-Toe
11. Lucky Thirteen
12. Craypots
