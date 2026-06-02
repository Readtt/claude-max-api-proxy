#!/usr/bin/env node
/**
 * Standalone server entry point (run without Clawdbot).
 *
 * Usage:
 *   npm run start
 *   node dist/server/standalone.js [port]
 *
 * All output goes through the shared logger (set LOG_LEVEL=debug for detail).
 */

import { startServer, stopServer } from "./index.js";
import { verifyClaude, verifyAuth } from "../subprocess/manager.js";
import { createLogger } from "../logger.js";

const log = createLogger("cli");
const DEFAULT_PORT = 3456;

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function main(): Promise<void> {
  // Parse port from the command line.
  const port = parseInt(process.argv[2] || String(DEFAULT_PORT), 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    log.error("invalid port", { value: process.argv[2] });
    process.exit(1);
  }

  // Verify the Claude CLI is installed.
  log.info("checking claude cli");
  const cliCheck = await verifyClaude();
  if (!cliCheck.ok) {
    log.error("claude cli not found", { error: cliCheck.error });
    process.exit(1);
  }
  log.info("claude cli ok", { version: cliCheck.version });

  // Verify authentication.
  const authCheck = await verifyAuth();
  if (!authCheck.ok) {
    log.error("not authenticated", {
      error: authCheck.error,
      hint: "run `claude` once to log in",
    });
    process.exit(1);
  }

  // Start the server (it logs "listening" with the endpoint URL).
  try {
    await startServer({ port });
    log.info("ready", { test: `curl http://localhost:${port}/v1/models` });
  } catch (err) {
    log.error("failed to start server", { error: errMessage(err) });
    process.exit(1);
  }

  // Graceful shutdown.
  const shutdown = async () => {
    log.info("shutting down");
    await stopServer();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  log.error("unexpected error", { error: errMessage(err) });
  process.exit(1);
});
