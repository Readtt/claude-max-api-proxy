/**
 * Optional API Key Authentication Middleware
 *
 * When API_KEYS env var is set, requires valid Bearer token.
 * When not set, all requests are allowed (backwards compatible).
 *
 * Set API_KEYS as comma-separated values:
 *   API_KEYS=sk-abc123,sk-def456 node dist/server/standalone.js
 */

import type { Request, Response, NextFunction } from "express";

let validKeys: Set<string> | null = null;

/**
 * Initialize auth from environment
 */
export function initAuth(): { enabled: boolean; keyCount: number } {
  const keysEnv = process.env.API_KEYS;
  if (keysEnv) {
    const keys = keysEnv.split(",").map(k => k.trim()).filter(Boolean);
    if (keys.length > 0) {
      validKeys = new Set(keys);
      return { enabled: true, keyCount: keys.length };
    }
  }
  validKeys = null;
  return { enabled: false, keyCount: 0 };
}

/**
 * Auth middleware - returns 401 if API_KEYS is set and token is invalid
 */
export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Auth disabled - pass through
  if (!validKeys) {
    next();
    return;
  }

  // Skip auth for health check
  if (req.path === "/health") {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({
      error: {
        message: "Missing Authorization header. Use: Authorization: Bearer <api-key>",
        type: "authentication_error",
        code: "missing_api_key",
      },
    });
    return;
  }

  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!validKeys.has(token)) {
    res.status(401).json({
      error: {
        message: "Invalid API key",
        type: "authentication_error",
        code: "invalid_api_key",
      },
    });
    return;
  }

  next();
}

/**
 * Check if auth is enabled
 */
export function isAuthEnabled(): boolean {
  return validKeys !== null;
}
