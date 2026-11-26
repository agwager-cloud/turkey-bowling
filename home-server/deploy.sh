#!/usr/bin/env bash
# Copies the game server to the home server and rebuilds it: `bash home-server/deploy.sh` from the repo folder.
# Needs the `pifractal-server` SSH name. Only the files the server needs are sent.
set -euo pipefail
cd "$(dirname "$0")/.."
tar czf - --exclude=node_modules --exclude=dist package.json package-lock.json client/package.json server home-server |
  ssh pifractal-server 'mkdir -p ~/games/turkey-bowling && cd ~/games/turkey-bowling && rm -rf server src && tar xzf - && cd home-server && docker compose -p game-turkey-bowling up -d --build && sleep 3 && docker ps --filter name=game-turkey-bowling --format "{{.Names}}: {{.Status}}" && curl -s -o /dev/null -w "HTTP %{http_code}\n" localhost:8344/'
