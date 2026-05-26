# elster-forms-api

A [Model Context Protocol](https://modelcontextprotocol.io) server that lets
LLMs help users prepare German ELSTER tax returns for trade tax (GewSt),
corporate income tax (KSt) and value-added tax (USt), years 2020-2025,
**without ever loading whole form schemas into the model's context**.

Forms have hundreds of lines each; loading one full annex into context already
burns five-figure token counts. This server exposes narrow, deterministic
read-only tools — the model fetches only the line, page or help snippet it
needs at any given step. Every response carries provenance so the LLM can
cite its sources and end users can verify what is shown to them.

The server does **not** submit returns to ELSTER. It describes structure and
content. Users still file through the official ELSTER portal themselves.

## Highlights

- **23 MCP tools** covering discovery, form structure, line metadata, help
  search, value validation, form recommendation, and persistent sessions.
- **Self-contained at runtime.** The ELSTER form data, official help
  markdowns, trigger index and help mapping all ship under `src/data/`.
  No upstream fetch, no submodule, works offline.
- **Two transports.** `stdio` for Claude Desktop / Claude Code, streamable
  HTTP behind Bearer auth for self-hosted deployments.
- **Anti-hallucination by design.** Every output has a provenance envelope.
  Unknown slugs and line numbers come back with Levenshtein suggestions.
  The server's `initialize` response instructs the model to refuse to
  invent identifiers.
- **Graceful degradation.** Missing trigger index or help mapping for a
  given year is logged as a warning and the affected tools return their
  best-effort output. Forms work even when triggers don't.

## Quick start

### Prerequisites

- Node.js >= 20.10. The repo ships with `.nvmrc` pinned to v24.
- Or: Docker / docker compose (no Node required on the host).

### Install and build

```sh
git clone https://github.com/lass-machen/elster-forms-api.git
cd elster-forms-api
npm install
npm run check    # typecheck + lint + format + tests
npm run build
```

### Run in stdio mode (Claude Desktop / Claude Code)

```sh
node dist/index.js --transport stdio
```

To attach to Claude Desktop, edit your config (`~/Library/Application
Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "elster-forms": {
      "command": "node",
      "args": ["/absolute/path/to/elster-forms-api/dist/index.js", "--transport", "stdio"]
    }
  }
}
```

Restart Claude Desktop. The tools appear under the `elster-forms` namespace.

For Claude Code:

```sh
claude mcp add elster-forms node /absolute/path/to/elster-forms-api/dist/index.js -- --transport stdio
```

### Run as an HTTP service (self-hosted)

```sh
cp .env.example .env
# Edit .env: set AUTH_TOKEN to a strong random string. The server refuses
# to start without it on the HTTP transport.
node dist/index.js --transport http
```

Default address: `http://0.0.0.0:8080`. MCP traffic terminates at `POST /mcp`;
clients pass `Authorization: Bearer <AUTH_TOKEN>` on every request. A liveness
endpoint is at `GET /healthz` (no auth required, returns `{ ok, version }`).

### Run with Docker

```sh
cp .env.example .env  # set AUTH_TOKEN
docker compose up -d --build
```

The named volume `elster-sessions` persists the session blobs across container
restarts. Bind it to a host path if you prefer:

```yaml
# compose.override.yaml
services:
  elster-forms-api:
    volumes:
      - ./var/sessions:/app/data/sessions
```

For multi-replica deployments, configure your ingress for sticky sessions on
the `mcp-session-id` header; the HTTP transport keeps in-memory state per
session.

## Configuration

Every variable can be set in `.env` (loaded automatically) or via the
environment. CLI flags override env values.

| Variable       | CLI flag         | Default         | Notes                                                                |
| -------------- | ---------------- | --------------- | -------------------------------------------------------------------- |
| `TRANSPORT`    | `--transport`    | `stdio`         | `stdio` or `http`.                                                   |
| `PORT`         | `--port`         | `8080`          | HTTP only.                                                           |
| `HOST`         | `--host`         | `0.0.0.0`       | HTTP only.                                                           |
| `AUTH_TOKEN`   | `--auth-token`   | —               | **Required** for HTTP. Bearer credential.                            |
| `LOG_LEVEL`    | `--log-level`    | `info`          | `silent`, `error`, `warn`, `info`, `debug`.                          |
| `DATA_DIR`     | `--data-dir`     | bundled         | Absolute path. Defaults to the data tree inside the package.         |
| `SESSIONS_DIR` | `--sessions-dir` | `data/sessions` | Where session JSON blobs go on disk. Bind a volume here in Docker.   |
| `DATA_COMMIT`  | —                | from data       | Override the `provenance.data_commit` string returned in tool calls. |

## What's in `src/data/`

```
src/data/
├── forms/                    consolidated form JSONs per (tax_type, year)
│   ├── kst/2020/…
│   ├── kst/2021/…
│   ├── …
│   └── ust/2025/…
├── help/                     copies of the official ELSTER help markdowns
│   ├── kst/2025/elster_kst2025_help.md
│   └── _index.json
├── trigger-index/            structured filing-trigger conditions per form
│   └── kst-2025.json
└── help-mapping/             form line → help anchor + snippet
    └── kst-2025.json
```

The form JSONs cover GewSt 2020-2025, KSt 2021-2025 and USt 2020-2025
(191 endpoint files). Help markdowns are present for every (type, year)
combination. Trigger index and help mapping are currently only available for
**KSt 2025**, which is the project's reference year; the server runs in a
degraded mode for the other (type, year) combinations: forms and help
search work, but `recommend_forms` cannot evaluate triggers and `get_line`
returns `help_snippet: null`.

To add or refresh those artifacts for another year, run the build pipeline in
the sister repository `elster-forms-data` (see `scripts/README.md` there),
review the diff, and copy the result back into `src/data/trigger-index/` and
`src/data/help-mapping/`. The expected build cost per (tax_type, year) on
Anthropic API is <5 USD at the time of writing.

## Tool reference

A short tour. Every tool returns the same envelope:

```jsonc
{
  "ok": true,
  "data": {
    /* tool-specific */
  },
  "provenance": {
    "data_commit": "274e0eb",
    "source": "Anlage GK 2025, page 4 / 2 - Bilanzielles Ergebnis, line 14",
    "help_source": "elster_kst2025_help.md#hinweise-zur-anlage-gk/bilanzielles-ergebnis/zeile-14",
  },
  "warnings": [],
}
```

Errors come back as `{ ok: false, error: { code, message, hint?, suggestions? } }`.

### Discovery

| Tool             | What it does                                                            |
| ---------------- | ----------------------------------------------------------------------- |
| `list_tax_types` | Returns the closed list of tax types this server serves.                |
| `list_years`     | Returns the available years for one tax type.                           |
| `list_forms`     | Returns every form (main + annexes) available for one (tax_type, year). |

### Form structure

| Tool                | What it does                                                            |
| ------------------- | ----------------------------------------------------------------------- |
| `get_form_outline`  | Compact line-by-line map (page/section/line/label/value_type), ~1-3 KB. |
| `get_form_triggers` | The structured filing triggers for a form (from the trigger index).     |
| `list_pages`        | Page index of a form, with per-page line counts.                        |
| `get_page`          | Full section/line tree of one page, with `allowed_values`.              |

### Lines and help

| Tool               | What it does                                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `get_line`         | One line: page label, section, value type, allowed values, help snippet, help_source. |
| `search_lines`     | Scored substring search across line labels.                                           |
| `search_help`      | Scored substring search across the help markdown.                                     |
| `get_help_section` | Resolve a `help_source` anchor to the full markdown body of that section.             |

### Validation and recommendation

| Tool              | What it does                                                                          |
| ----------------- | ------------------------------------------------------------------------------------- |
| `validate_value`  | Type-check a value against a line's `value_type`. German `DD.MM.YYYY` for dates, etc. |
| `recommend_forms` | Given a profile, return `recommended` / `evaluated` / `unanswered_conditions`.        |

### Sessions

| Tool                         | What it does                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------- |
| `session_start`              | Begin a new (tax_type, year) session, optionally seeded with a partial profile. |
| `session_set_profile_field`  | Set one typed profile field.                                                    |
| `session_set_profile_note`   | Store a free-form note on the profile.                                          |
| `session_set_field`          | Validate and persist a value for one form line.                                 |
| `session_select_form`        | Add a form to the session's `selected_forms`.                                   |
| `session_deselect_form`      | Remove a form from `selected_forms`.                                            |
| `session_get_status`         | Compact status snapshot (selected forms, filled count, missing profile fields). |
| `session_get_open_questions` | Profile fields still unanswered plus annex conditions the server cannot decide. |
| `session_export`             | Return the full session JSON blob (for cross-session recovery).                 |
| `session_import`             | Persist a previously exported session blob.                                     |

## Worked example: a small GmbH, KSt 2025

```text
1. list_tax_types                                        -> kst available
2. list_years(tax_type=kst)                              -> 2025 available
3. session_start(tax_type=kst, year=2025,
                 initial_profile={legal_form: GmbH})     -> session_id
4. session_get_open_questions(session_id)                -> ask user about:
                                                           - business_type
                                                           - has_foreign_operations
                                                           - has_economic_business_activity
                                                           - is_organschaft_subsidiary
                                                           - is_organschaft_parent
                                                           - has_loss_carryforward
5. session_set_profile_field(...) for each answer
6. recommend_forms(...)                                  -> Hauptvordruck + GK + ZVE
7. session_select_form(form_slug=anlage-gk)
8. get_form_outline(form_slug=anlage-gk)                 -> entire form map
9. get_line / session_set_field per filled-in row
10. session_export(...)                                  -> blob to resume later
```

## Development

```sh
npm run dev:stdio       # tsx-driven stdio server
npm run dev:http        # tsx-driven HTTP server
npm run typecheck
npm run lint
npm run lint:fix
npm run format
npm run test
npm run test:watch
npm run test:coverage
npm run check           # everything in one go
npm run build           # compile + bundle data tree
```

### Project layout

```
src/
├── index.ts             entry point (CLI + transport selection)
├── server.ts            MCP server wiring, tool registration
├── instructions_header.ts  server instructions sent on initialize
├── env.ts               CLI/env parsing + path resolution
├── errors.ts            typed error codes
├── logger.ts            stderr JSON-line logger
├── provenance.ts        envelope provenance helpers
├── package_info.ts      package name/version from package.json
├── transports/
│   ├── stdio.ts
│   └── http.ts          Express + Bearer auth + StreamableHTTPServerTransport
├── catalogue/
│   ├── types.ts         normalized data model
│   ├── slugify.ts       same algorithm as the upstream data pipeline
│   ├── normalize.ts     raw JSON → normalized in-memory model
│   ├── help_tree.ts     markdown heading-tree parser + anchor resolver
│   ├── search.ts        scored substring search (lines + help)
│   └── loader.ts        boot-time catalogue load with degraded-mode warnings
├── tools/
│   ├── envelope.ts      tool runner: input validation, error handling, provenance
│   ├── registry.ts      canonical tool ordering
│   ├── lookups.ts       resolve tax_type / year / form / line with fuzzy hints
│   ├── discovery.ts     list_tax_types, list_years, list_forms
│   ├── structure.ts     get_form_outline, get_form_triggers, list_pages, get_page
│   ├── lines.ts         get_line, search_lines
│   ├── help.ts          search_help, get_help_section
│   ├── validation.ts    validate_value
│   ├── recommendation.ts recommend_forms with profile-driven machine_check
│   └── sessions.ts      all session_* tools
├── validator/
│   └── index.ts         per-value-type validators (German DD.MM.YYYY, etc.)
├── session/
│   ├── types.ts         SessionFile Zod schema
│   ├── store.ts         atomic-write FS-backed session store
│   └── profile_schemas.ts per-tax-type profiles + German question metadata
└── data/                runtime data tree (see "What's in src/data/")
test/
├── helpers.ts
├── catalogue.test.ts
├── validator.test.ts
└── tools.test.ts
```

### Conventions

- **TypeScript strict**, no `any` outside narrow boundary code.
- **English** for identifiers, comments, log messages and docs. **German**
  only for ELSTER content strings (labels, allowed values, help text).
- **No emojis** in source, commits or docs.
- **Conventional Commits** in English.
- **No request-path LLM calls.** Every tool is deterministic against the
  in-memory catalogue. LLM use lives only in the build pipeline in the
  sister data repo.
- **No mutation of the in-memory catalogue from tool handlers.** The catalogue
  is treated as immutable after `loadCatalogue`.

## Security notes

- HTTP transport requires `AUTH_TOKEN`; missing token aborts startup.
- Sessions are stored on disk as JSON blobs. They contain the user's profile
  answers and filled values — treat the `data/sessions/` directory as PII.
- No external telemetry, no anonymous usage tracking. The server makes no
  outbound network calls.
- `npm audit` flags moderate-severity advisories in vitest's transitive
  `esbuild` dependency. These apply to the dev-time vite server only and
  are not part of the runtime image; production builds do not include
  vitest.

## License

MIT — see [LICENSE](LICENSE). The bundled ELSTER form data and help texts
remain the copyright of the German tax administration; this repository
reproduces them for educational and tooling purposes.
