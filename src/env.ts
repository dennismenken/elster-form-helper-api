import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseLogLevel, type LogLevel } from "./logger.js";

/**
 * Resolved at module-load time:
 *
 *   MODULE_DIR is the directory containing this file, which is `src/` when
 *   running under tsx in development and `dist/` after `npm run build`. The
 *   catalogue's `data/` tree lives next to this directory (the build copy
 *   step in `scripts/copy-data.mjs` mirrors `src/data` → `dist/data`).
 *
 *   PACKAGE_ROOT is one level up — the actual project root, useful for
 *   resolving non-bundled paths like the runtime sessions directory.
 */
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = path.resolve(MODULE_DIR, "..");
const DEFAULT_DATA_DIR = path.join(MODULE_DIR, "data");

export type TransportKind = "stdio" | "http";

export interface ServerConfig {
  transport: TransportKind;
  host: string;
  port: number;
  authToken: string | null;
  logLevel: LogLevel;
  dataDir: string;
  sessionsDir: string;
  /** Optional explicit override for the `data_commit` field in tool outputs.
   *  Useful in CI where multiple deploys may run against the same git ref. */
  dataCommitOverride: string | null;
}

export interface RawCliArgs {
  transport?: string;
  port?: string;
  host?: string;
  authToken?: string;
  logLevel?: string;
  dataDir?: string;
  sessionsDir?: string;
}

/**
 * Build the runtime configuration from environment variables, optionally
 * overridden by parsed CLI arguments. The CLI wins when both are present.
 *
 * Throws on invalid combinations (e.g. HTTP transport without an AUTH_TOKEN)
 * — the server refuses to start in an insecure or undefined configuration.
 */
export function loadConfig(env: NodeJS.ProcessEnv, cli: RawCliArgs = {}): ServerConfig {
  const transport = parseTransport(cli.transport ?? env.TRANSPORT);
  const host = cli.host ?? env.HOST ?? "0.0.0.0";
  const port = parsePort(cli.port ?? env.PORT ?? "8080");
  const authTokenRaw = (cli.authToken ?? env.AUTH_TOKEN ?? "").trim();
  const authToken = authTokenRaw.length > 0 ? authTokenRaw : null;
  const logLevel = parseLogLevel(cli.logLevel ?? env.LOG_LEVEL);

  if (transport === "http" && authToken === null) {
    throw new Error(
      "HTTP transport requires AUTH_TOKEN (env) or --auth-token (CLI). Refusing to start without authentication."
    );
  }

  const dataDir = cli.dataDir
    ? path.resolve(cli.dataDir)
    : env.DATA_DIR
      ? path.resolve(env.DATA_DIR)
      : DEFAULT_DATA_DIR;
  const sessionsDir = cli.sessionsDir
    ? path.resolve(cli.sessionsDir)
    : env.SESSIONS_DIR
      ? path.resolve(env.SESSIONS_DIR)
      : path.resolve(PACKAGE_ROOT, "data", "sessions");

  return {
    transport,
    host,
    port,
    authToken,
    logLevel,
    dataDir,
    sessionsDir,
    dataCommitOverride: env.DATA_COMMIT?.trim() ? env.DATA_COMMIT.trim() : null,
  };
}

function parseTransport(input: string | undefined): TransportKind {
  const v = (input ?? "stdio").toLowerCase();
  if (v === "stdio" || v === "http") return v;
  throw new Error(`Unknown transport '${input ?? ""}'. Use 'stdio' or 'http'.`);
}

function parsePort(input: string): number {
  const n = Number(input);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) {
    throw new Error(`Invalid PORT '${input}'. Expected integer in 1..65535.`);
  }
  return n;
}

/**
 * Minimal argv parser. Accepts `--key=value` and `--key value` forms; values
 * without `--` prefix are ignored. Returns a plain object keyed by camelCase.
 */
export function parseArgv(argv: readonly string[]): RawCliArgs {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? "";
    if (!token.startsWith("--")) continue;
    const stripped = token.slice(2);
    const eqIdx = stripped.indexOf("=");
    let key: string;
    let value: string;
    if (eqIdx >= 0) {
      key = stripped.slice(0, eqIdx);
      value = stripped.slice(eqIdx + 1);
    } else {
      key = stripped;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        value = "true";
      } else {
        value = next;
        i++;
      }
    }
    out[toCamel(key)] = value;
  }
  return out;
}

function toCamel(s: string): string {
  return s.replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
}
