/**
 * Tiny dependency-free leveled logger.
 *
 * Level is set by `LOG_LEVEL` (error | warn | info | debug); default `info`.
 * The legacy `DEBUG` env var still forces `debug`. Each line is:
 *
 *   2026-06-02T19:07:59.801Z INFO  [scope] message key=value key2=value2
 *
 * error/warn go to stderr, info/debug to stdout, so logs never get mixed into
 * an error stream a supervisor might treat specially.
 */

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

function configuredThreshold(): number {
  const env = (process.env.LOG_LEVEL || "").toLowerCase();
  if (env in LEVELS) return LEVELS[env as LogLevel];
  if (process.env.DEBUG) return LEVELS.debug;
  return LEVELS.info;
}

// Resolved once at startup; cheap and avoids re-reading env on every line.
const threshold = configuredThreshold();

/** Render a metadata value compactly: quote strings with spaces, stringify objects. */
function formatValue(v: unknown): string {
  if (v === null || v === undefined) return String(v);
  if (typeof v === "string") return /\s/.test(v) ? JSON.stringify(v) : v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function emit(
  level: LogLevel,
  scope: string,
  message: string,
  extra?: Record<string, unknown>
): void {
  if (LEVELS[level] > threshold) return;

  let tail = "";
  if (extra) {
    const parts = Object.entries(extra)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => `${k}=${formatValue(v)}`);
    if (parts.length) tail = " " + parts.join(" ");
  }

  const line = `${new Date().toISOString()} ${level
    .toUpperCase()
    .padEnd(5)} [${scope}] ${message}${tail}`;

  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export interface Logger {
  error(message: string, extra?: Record<string, unknown>): void;
  warn(message: string, extra?: Record<string, unknown>): void;
  info(message: string, extra?: Record<string, unknown>): void;
  debug(message: string, extra?: Record<string, unknown>): void;
}

/** Create a logger bound to a scope label, e.g. createLogger("server"). */
export function createLogger(scope: string): Logger {
  return {
    error: (m, e) => emit("error", scope, m, e),
    warn: (m, e) => emit("warn", scope, m, e),
    info: (m, e) => emit("info", scope, m, e),
    debug: (m, e) => emit("debug", scope, m, e),
  };
}

/** The active log level name (for diagnostics / health output). */
export function currentLevel(): LogLevel {
  return (Object.keys(LEVELS) as LogLevel[]).find(
    (k) => LEVELS[k] === threshold
  )!;
}
