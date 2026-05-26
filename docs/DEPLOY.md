# Deploying elster-forms-api

End-to-end deployment of the MCP server behind Traefik on a single-host
Docker setup. Adjust the domain, certresolver name and external network name
to match your environment.

## Prerequisites on the server

- Docker engine with the Compose plugin (`docker compose version` returns `v2.x`).
- An existing Traefik instance that joins an external Docker network (named
  `traefik` in this guide) and has a Let's Encrypt certresolver labelled `le`.
- DNS A/AAAA record for the target domain pointing at the host.

## One-time setup

```sh
# Clone next to your other services
mkdir -p /opt/services/init4 && cd /opt/services/init4
git clone https://github.com/lass-machen/elster-forms-api.git
cd elster-forms-api
```

## `.env`

Save this as `/opt/services/init4/elster-forms-api/.env`. The file is
gitignored.

```ini
# elster-forms-api — production
# Transport runs HTTP only on the server; stdio is for local dev / Claude Desktop.
TRANSPORT=http
HOST=0.0.0.0
PORT=8080

# Bearer credential. Generate ONCE per environment. Rotate by replacing the
# value and restarting the container (clients then need the new token).
# Generation: openssl rand -hex 32
AUTH_TOKEN=REPLACE_ME_WITH_OPENSSL_RAND_HEX_32

# silent | error | warn | info | debug. `info` keeps the log digestible.
LOG_LEVEL=info

# Sessions persist inside the container at /app/data/sessions, which the
# compose file binds to the named volume `elster-sessions`. Override only
# if you want a host-path bind mount.
SESSIONS_DIR=/app/data/sessions
```

Generate the token:

```sh
echo "AUTH_TOKEN=$(openssl rand -hex 32)" >> .env
# then open .env and remove the placeholder line that contained REPLACE_ME
```

Keep the token in a password manager. Anyone holding it has full access to
the server's MCP tools.

## `compose.override.yaml`

Save this as `/opt/services/init4/elster-forms-api/compose.override.yaml`. It
joins the existing `traefik` network and registers the routing rules for
`elster.datamo.de`. The file is gitignored.

```yaml
services:
  elster-forms-api:
    networks:
      - default
      - traefik
    labels:
      traefik.enable: true
      traefik.docker.network: traefik
      traefik.http.routers.elster-forms-api.rule: Host(`elster.datamo.de`)
      traefik.http.routers.elster-forms-api.entrypoints: websecure
      traefik.http.routers.elster-forms-api.tls: true
      traefik.http.routers.elster-forms-api.tls.certresolver: le
      traefik.http.services.elster-forms-api.loadbalancer.server.port: 8080

networks:
  traefik:
    external: true
```

Notes:

- `elster.datamo.de` is already a subdomain — no www variant or redirect
  middleware needed (unlike the silbenteppich-generator example which has a
  bare `silbenteppich.de` + `www.silbenteppich.de` redirect).
- The service port inside the container is **8080** (set via the `PORT` env
  in `.env`). Traefik routes the public HTTPS request to that port over the
  shared docker network.
- The base `compose.yaml` in this repo publishes port `8080` to the host on
  `${PUBLIC_PORT:-8080}`. With Traefik in front you do not need that
  port-publish at all; you can drop it by also adding to the override:

  ```yaml
  services:
    elster-forms-api:
      ports: []
  ```

  This keeps the service reachable only via Traefik.

## Bring the service up

```sh
docker compose up -d --build
docker compose ps             # confirm "running" + "healthy"
docker compose logs --tail=50 elster-forms-api
```

The container logs JSON lines on stderr. On a clean start you should see
something like:

```json
{"ts":"…","level":"info","event":"server.starting","transport":"http",…}
{"ts":"…","level":"info","event":"catalogue.loaded","forms":174,"help_files":17,"help_mappings":323,"warnings":…,"data_commit":"…"}
{"ts":"…","level":"info","event":"transport.http.listening","host":"0.0.0.0","port":8080}
```

If `server.no_forms` appears, the data tree did not make it into the image —
rebuild after pulling the latest commits.

## Smoke-test against the deployed endpoint

```sh
# Healthz (no auth, public — useful for monitoring)
claude-curl -s https://elster.datamo.de/healthz
# → {"ok":true,"version":"0.1.0"}

# Initialize handshake (auth required)
claude-curl -s https://elster.datamo.de/mcp \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}'
```

The second call returns an SSE `event: message` line with the MCP
initialize result, including the server instructions. Anything else
(`401`, connection refused, certificate error) is a misconfiguration in
auth, network attachment, or DNS/certresolver.

## Attaching a remote MCP client

Claude Desktop and Claude Code attach to a remote MCP via the `http`
transport. Example for Claude Code:

```sh
claude mcp add elster-forms-remote --transport http \
  https://elster.datamo.de/mcp \
  --header "Authorization: Bearer $AUTH_TOKEN"
```

For Claude Desktop the equivalent goes into the user's MCP config (see the
project README for the JSON shape). Use the same Bearer token.

## Upgrading

```sh
cd /opt/services/init4/elster-forms-api
git pull --ff-only
docker compose up -d --build
```

The container persists the session blobs in the named volume
`elster-sessions` across rebuilds; profile state and filled values survive.

## Operational notes

- **Token rotation:** edit `AUTH_TOKEN` in `.env`, `docker compose up -d`
  rebuilds env. Reconnect every client with the new token.
- **Logs:** `docker compose logs -f elster-forms-api`. The JSON lines are
  structured for tooling — `jq` works directly.
- **Healthcheck:** the Dockerfile defines a `wget /healthz` probe every
  30s; failures show up in `docker compose ps` as `unhealthy`.
- **Backups:** snapshot the `elster-sessions` named volume on whatever
  cadence you back up the rest of `/opt/services/init4/`.
- **Resource footprint:** ~80 MB resident, single Node process. Suitable
  for a small VM without dedicated tuning.

## Troubleshooting checklist

| Symptom                                                | Probable cause                                                                |
| ------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `server.no_forms` on startup                           | Build step did not copy `src/data/` into the image — rebuild from clean.      |
| Traefik returns 404 for `elster.datamo.de`             | Container not on `traefik` network, label key typo, or DNS not propagated.   |
| `401 unauthorized` on every `POST /mcp`                | `Authorization: Bearer <token>` missing or token mismatched with `.env`.    |
| MCP client connects then hangs on `tools/list`         | Container healthy but Traefik buffering: try `--header "Accept: application/json, text/event-stream"`. |
| `recommend_forms` returns many `unanswered_conditions` | Profile missing fields — extend the profile with the 4 new KSt fields (`is_support_fund`, `is_municipal_subsidiary`, `has_cbc_reporting_obligation`, `has_significant_interest_expense`). |
