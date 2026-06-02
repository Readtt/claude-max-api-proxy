/**
 * Express HTTP Server
 *
 * Provides OpenAI-compatible API endpoints that wrap Claude Code CLI
 */

import express, { Express, Request, Response, NextFunction } from "express";
import { createServer, Server } from "http";
import { handleChatCompletions, handleModels, handleModel, handleHealth, handleUsage, handleUsageRecent } from "./routes.js";
import { initAuth, authMiddleware } from "./auth.js";
import { createLogger, currentLevel } from "../logger.js";

const log = createLogger("server");

export interface ServerConfig {
  port: number;
  host?: string;
}

let serverInstance: Server | null = null;

/**
 * Create and configure the Express app
 */
function createApp(): Express {
  const app = express();

  // Initialize auth
  const authStatus = initAuth();
  if (authStatus.enabled) {
    log.info("api key auth enabled", { keys: authStatus.keyCount });
  }

  // Middleware
  app.use(express.json({ limit: "10mb" }));

  // Per-request access logging (debug level)
  app.use((req: Request, _res: Response, next: NextFunction) => {
    log.debug("request", { method: req.method, path: req.path });
    next();
  });

  // CORS headers for local development
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  // Handle OPTIONS preflight
  app.options("*", (_req: Request, res: Response) => {
    res.sendStatus(200);
  });

  // Auth middleware (skips /health automatically)
  app.use(authMiddleware);

  // Routes
  app.get("/health", handleHealth);
  app.get("/v1/models", handleModels);
  app.get("/v1/models/:model", handleModel);
  app.post("/v1/chat/completions", handleChatCompletions);
  app.get("/v1/usage", handleUsage);
  app.get("/v1/usage/recent", handleUsageRecent);

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({
      error: {
        message: "Not found",
        type: "invalid_request_error",
        code: "not_found",
      },
    });
  });

  // Error handler
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    log.error("unhandled error", { error: err.message });
    res.status(500).json({
      error: {
        message: err.message,
        type: "server_error",
        code: null,
      },
    });
  });

  return app;
}

/**
 * Start the HTTP server
 */
export async function startServer(config: ServerConfig): Promise<Server> {
  const { port, host = "127.0.0.1" } = config;

  if (serverInstance) {
    log.warn("server already running, returning existing instance");
    return serverInstance;
  }

  const app = createApp();

  return new Promise((resolve, reject) => {
    serverInstance = createServer(app);

    serverInstance.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${port} is already in use`));
      } else {
        reject(err);
      }
    });

    serverInstance.listen(port, host, () => {
      log.info("listening", {
        url: `http://${host}:${port}`,
        endpoint: `http://${host}:${port}/v1/chat/completions`,
        logLevel: currentLevel(),
      });
      resolve(serverInstance!);
    });
  });
}

/**
 * Stop the HTTP server
 */
export async function stopServer(): Promise<void> {
  if (!serverInstance) {
    return;
  }

  return new Promise((resolve, reject) => {
    serverInstance!.close((err) => {
      if (err) {
        reject(err);
      } else {
        log.info("stopped");
        serverInstance = null;
        resolve();
      }
    });
  });
}

/**
 * Get the current server instance
 */
export function getServer(): Server | null {
  return serverInstance;
}
