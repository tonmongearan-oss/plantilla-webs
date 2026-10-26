# syntax=docker/dockerfile:1
# Una sola imagen para la API y el worker, y otra (Caddy) para servir la web con HTTPS.

# ---------- API y worker ----------
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production NODE_NO_WARNINGS=1
COPY package.json package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force
COPY server ./server
COPY sitios ./sitios
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server/src/server.ts"]

# ---------- construcción de la web estática ----------
FROM node:22-alpine AS webbuild
ARG SITE
WORKDIR /w
COPY web ./web
COPY sitios ./sitios
RUN node web/build.mjs --site "$SITE"

# ---------- servidor web (HTTPS automático con Let's Encrypt) ----------
FROM caddy:2-alpine AS web
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=webbuild /w/web/dist /srv
