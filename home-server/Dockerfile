# Game server for the home server (replaces Render). Built from the repo root:
# only the server workspace is installed and built; the client is still published to itch.io.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace server --include-workspace-root=false
COPY server/ server/
RUN npm run build --workspace server

FROM node:22-alpine
ENV NODE_ENV=production PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspace server --include-workspace-root=false --omit=dev && npm cache clean --force
COPY --from=build /app/server/dist server/dist
WORKDIR /app/server
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
