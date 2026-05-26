/**
 * Tiny structured logger. Writes JSON lines to stderr so stdout stays free
 * for MCP traffic on the stdio transport. Set `LOG_LEVEL=silent` to mute.
 */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

const LEVELS: Record<LogLevel, number> = {
  silent: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4,
};

export interface Logger {
  error: (event: string, fields?: Record<string, unknown>) => void;
  warn: (event: string, fields?: Record<string, unknown>) => void;
  info: (event: string, fields?: Record<string, unknown>) => void;
  debug: (event: string, fields?: Record<string, unknown>) => void;
  child: (bindings: Record<string, unknown>) => Logger;
}

export function createLogger(level: LogLevel = "info"): Logger {
  return buildLogger(level, {});
}

function buildLogger(level: LogLevel, bindings: Record<string, unknown>): Logger {
  const threshold = LEVELS[level];

  function emit(eventLevel: LogLevel, event: string, fields?: Record<string, unknown>): void {
    if (LEVELS[eventLevel] > threshold) return;
    const payload = {
      ts: new Date().toISOString(),
      level: eventLevel,
      event,
      ...bindings,
      ...fields,
    };
    process.stderr.write(`${JSON.stringify(payload)}\n`);
  }

  return {
    error: (event, fields) => emit("error", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    info: (event, fields) => emit("info", event, fields),
    debug: (event, fields) => emit("debug", event, fields),
    child: (extra) => buildLogger(level, { ...bindings, ...extra }),
  };
}

export function parseLogLevel(input: string | undefined): LogLevel {
  if (input == null) return "info";
  const normalized = input.toLowerCase();
  if (normalized in LEVELS) return normalized as LogLevel;
  return "info";
}
