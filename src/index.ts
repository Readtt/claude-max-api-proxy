/**
 * Claude Code CLI Provider Plugin for Clawdbot
 *
 * Enables using Claude Max subscription through Claude Code CLI,
 * bypassing OAuth token scope restrictions.
 */

import { startServer, stopServer, getServer } from "./server/index.js";
import { verifyClaude, verifyAuth } from "./subprocess/manager.js";
import {
  listModels,
  DEFAULT_MODEL_ALIAS,
  type ModelFamily,
  type ProxyModel,
} from "./models.js";
import { createLogger } from "./logger.js";

const log = createLogger("plugin");

// Provider constants
const PROVIDER_ID = "claude-code-cli";
const PROVIDER_LABEL = "Claude Code CLI";
const DEFAULT_PORT = 3456;
// Default to the evergreen latest in the default family (no version to maintain).
const DEFAULT_MODEL = `${PROVIDER_ID}/${DEFAULT_MODEL_ALIAS}`;

const FAMILY_LABELS: Record<ModelFamily, string> = {
  opus: "Claude Opus (latest)",
  fable: "Claude Fable (latest)",
  sonnet: "Claude Sonnet (latest)",
  haiku: "Claude Haiku (latest)",
};

/**
 * Build a Clawdbot model definition from a proxy model. Names come from the
 * family so they never go stale; all current Claude models support reasoning.
 */
function buildModelDefinition(model: ProxyModel) {
  return {
    id: model.id,
    name: FAMILY_LABELS[model.family] ?? model.id,
    api: "openai-completions",
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 200000,
    maxTokens: 8192,
  };
}

/**
 * Empty plugin config schema (no user configuration needed)
 */
function emptyPluginConfigSchema() {
  return {
    type: "object" as const,
    properties: {},
    additionalProperties: false,
  };
}

/**
 * Plugin definition
 */
const claudeCodeCliPlugin = {
  id: "claude-code-cli-provider",
  name: "Claude Code CLI Provider",
  description:
    "Use Claude Max subscription via Claude Code CLI (bypasses OAuth restrictions)",
  configSchema: emptyPluginConfigSchema(),

  register(api: any) {
    let serverPort = DEFAULT_PORT;

    // Register the provider
    api.registerProvider({
      id: PROVIDER_ID,
      label: PROVIDER_LABEL,
      docsPath: "/providers/claude-code-cli",
      aliases: ["claude-cli", "claude-max"],
      envVars: [], // No env vars needed - uses Claude CLI auth

      auth: [
        {
          id: "local",
          label: "Local Claude CLI",
          hint: "Uses your existing Claude Code CLI authentication (from Claude Max)",
          kind: "custom",

          run: async (ctx: any) => {
            const spin = ctx.prompter.progress("Checking Claude CLI...");

            try {
              // 1. Verify Claude CLI is installed
              const cliCheck = await verifyClaude();
              if (!cliCheck.ok) {
                spin.stop("Claude CLI not found");
                await ctx.prompter.note(
                  "Install Claude Code: npm install -g @anthropic-ai/claude-code",
                  "Installation"
                );
                throw new Error(cliCheck.error);
              }
              spin.message("Claude CLI found, checking auth...");

              // 2. Verify authentication
              const authCheck = await verifyAuth();
              if (!authCheck.ok) {
                spin.stop("Not authenticated");
                await ctx.prompter.note(
                  "Run 'claude auth login' to authenticate with your Claude Max account",
                  "Authentication"
                );
                throw new Error(authCheck.error);
              }
              spin.message("Authenticated, starting server...");

              // 3. Ask for port
              const portInput = await ctx.prompter.text({
                message: "Local server port",
                initialValue: String(DEFAULT_PORT),
                validate: (v: string) => {
                  const p = parseInt(v, 10);
                  if (isNaN(p) || p < 1 || p > 65535) {
                    return "Enter a valid port (1-65535)";
                  }
                  return undefined;
                },
              });
              serverPort = parseInt(portInput, 10);

              // 4. Start the local server
              await startServer({ port: serverPort });
              spin.stop("Claude CLI provider ready");

              const baseUrl = `http://127.0.0.1:${serverPort}/v1`;

              return {
                profiles: [
                  {
                    profileId: `${PROVIDER_ID}:local`,
                    credential: {
                      type: "token",
                      provider: PROVIDER_ID,
                      token: "local", // Dummy token - CLI handles auth
                    },
                  },
                ],
                configPatch: {
                  models: {
                    providers: {
                      [PROVIDER_ID]: {
                        baseUrl,
                        apiKey: "local",
                        api: "openai-completions",
                        authHeader: false,
                        models: listModels().map(buildModelDefinition),
                      },
                    },
                  },
                  agents: {
                    defaults: {
                      models: Object.fromEntries(
                        listModels().map((m) => [
                          `${PROVIDER_ID}/${m.id}`,
                          {},
                        ])
                      ),
                    },
                  },
                },
                defaultModel: DEFAULT_MODEL,
                notes: [
                  "This uses your Claude Max subscription via Claude Code CLI.",
                  "Your OAuth token is used by the CLI, not exposed directly.",
                  `Local server running at http://127.0.0.1:${serverPort}`,
                  "Keep the server running to use this provider.",
                ],
              };
            } catch (err) {
              spin.stop("Setup failed");
              throw err;
            }
          },
        },
      ],
    });

    // Handle plugin unload
    api.on("plugin:unload", async () => {
      const server = getServer();
      if (server) {
        log.info("stopping server on plugin unload");
        await stopServer();
      }
    });

    // Register CLI command for manual server control
    api.registerCli?.((cli: any) => {
      cli
        .command("claude-cli:start [port]")
        .description("Start the Claude CLI proxy server")
        .action(async (port: string) => {
          const p = parseInt(port || String(DEFAULT_PORT), 10);
          await startServer({ port: p });
          log.info("server started", { port: p });
        });

      cli
        .command("claude-cli:stop")
        .description("Stop the Claude CLI proxy server")
        .action(async () => {
          await stopServer();
          log.info("server stopped");
        });

      cli
        .command("claude-cli:status")
        .description("Check Claude CLI proxy server status")
        .action(() => {
          const server = getServer();
          log.info("server status", {
            running: !!server,
            port: server ? serverPort : undefined,
          });
        });
    });

    log.info("plugin registered");
  },
};

export default claudeCodeCliPlugin;

// Also export server utilities for standalone use
export { startServer, stopServer, getServer } from "./server/index.js";
export { ClaudeSubprocess, verifyClaude, verifyAuth } from "./subprocess/manager.js";
export { usageTracker } from "./usage/tracker.js";
export type { UsageSummary, RequestRecord } from "./usage/tracker.js";
