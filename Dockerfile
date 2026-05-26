# Multi-stage build. The final image carries only the production runtime
# (compiled JS + bundled data tree + production node_modules). The build
# stage holds devDependencies and source files; it is discarded.

FROM node:24-alpine AS builder
WORKDIR /app
# NODE_ENV is deliberately not set yet — we need devDependencies (tsc, etc.)
# for the build. They get pruned once the build is done.
COPY package.json package-lock.json* ./
# `--ignore-scripts` skips lifecycle hooks that would otherwise pull in
# extras; we keep our scripts minimal but the flag costs nothing.
RUN npm ci --ignore-scripts --include=dev
COPY tsconfig.json tsconfig.build.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build && npm prune --omit=dev


FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Non-root user for the running process. The data/sessions volume is owned
# by this user so per-user state can be written without escalating.
RUN addgroup -S elster && adduser -S -G elster elster

COPY --chown=elster:elster --from=builder /app/node_modules ./node_modules
COPY --chown=elster:elster --from=builder /app/dist ./dist
COPY --chown=elster:elster --from=builder /app/package.json ./package.json
COPY --chown=elster:elster LICENSE README.md ./

# Persist sessions across container restarts via a named volume.
RUN mkdir -p /app/data/sessions && chown -R elster:elster /app/data
VOLUME ["/app/data/sessions"]

USER elster
EXPOSE 8080
ENV TRANSPORT=http \
    PORT=8080 \
    HOST=0.0.0.0 \
    LOG_LEVEL=info \
    SESSIONS_DIR=/app/data/sessions

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- "http://127.0.0.1:${PORT}/healthz" || exit 1

ENTRYPOINT ["node", "dist/index.js"]
CMD ["--transport", "http"]
