/**
 * Claude Code CLI Subprocess Manager
 *
 * Handles spawning, managing, and parsing output from Claude CLI subprocesses.
 * Uses spawn() instead of exec() to prevent shell injection vulnerabilities.
 */

import { spawn, ChildProcess } from "child_process";
import { EventEmitter } from "events";
import fs from "fs/promises";
import { mkdirSync } from "fs";
import os from "os";
import path from "path";
import type {
  ClaudeCliMessage,
  ClaudeCliAssistant,
  ClaudeCliResult,
  ClaudeCliStreamEvent,
} from "../types/claude-cli.js";
import { isAssistantMessage, isResultMessage, isContentDelta } from "../types/claude-cli.js";
import type { ClaudeModel, AnthropicImageBlock } from "../adapter/openai-to-cli.js";

export interface SubprocessOptions {
  model: ClaudeModel;
  sessionId?: string;
  systemPrompt?: string;
  cwd?: string;
  timeout?: number;
  /** Image content blocks; when present the prompt is sent as stream-json. */
  images?: AnthropicImageBlock[];
}

export interface SubprocessEvents {
  message: (msg: ClaudeCliMessage) => void;
  assistant: (msg: ClaudeCliAssistant) => void;
  result: (result: ClaudeCliResult) => void;
  error: (error: Error) => void;
  close: (code: number | null) => void;
  raw: (line: string) => void;
}

const DEFAULT_TIMEOUT = 600000; // 10 minutes

// Unique-enough suffix for temp system-prompt files (no Date.now needed)
let promptFileCounter = 0;

// An empty, dedicated working directory for the CLI. Running here (instead of
// the directory the server happens to be started from) keeps the proxy from
// auto-discovering a project's CLAUDE.md or files, so responses are consistent
// no matter where the server runs.
let isolatedCwd: string | null = null;
function getIsolatedCwd(): string {
  if (!isolatedCwd) {
    isolatedCwd = path.join(os.tmpdir(), "claude-max-api-proxy-cwd");
    try {
      mkdirSync(isolatedCwd, { recursive: true });
    } catch {
      // Fall back to tmpdir if creation fails
      isolatedCwd = os.tmpdir();
    }
  }
  return isolatedCwd;
}

export class ClaudeSubprocess extends EventEmitter {
  private process: ChildProcess | null = null;
  private buffer: string = "";
  private timeoutId: NodeJS.Timeout | null = null;
  private isKilled: boolean = false;
  private systemPromptFile: string | null = null;
  private lastStderr: string = "";

  /**
   * Start the Claude CLI subprocess with the given prompt.
   *
   * Both the prompt and the system prompt are kept OFF the command line:
   *   - prompt        -> written to the CLI's stdin
   *   - systemPrompt  -> written to a temp file, passed via --append-system-prompt-file
   * This avoids E2BIG (Linux/macOS) and the ~32 KB command-line cap (Windows),
   * which otherwise killed large first messages (e.g. code-review diffs) before
   * streaming even started.
   */
  async start(prompt: string, options: SubprocessOptions): Promise<void> {
    const timeout = options.timeout || DEFAULT_TIMEOUT;

    // Write the system prompt to a temp file so it never hits the command line.
    if (options.systemPrompt) {
      this.systemPromptFile = path.join(
        os.tmpdir(),
        `claude-max-sysprompt-${process.pid}-${++promptFileCounter}.txt`
      );
      await fs.writeFile(this.systemPromptFile, options.systemPrompt, "utf8");
    }

    const args = this.buildArgs(options);

    return new Promise((resolve, reject) => {
      try {
        // Use spawn() for security - no shell interpretation
        this.process = spawn("claude", args, {
          cwd: options.cwd || getIsolatedCwd(),
          env: { ...process.env },
          stdio: ["pipe", "pipe", "pipe"],
        });

        // Set timeout
        this.timeoutId = setTimeout(() => {
          if (!this.isKilled) {
            this.isKilled = true;
            this.process?.kill("SIGTERM");
            this.emit("error", new Error(`Request timed out after ${timeout}ms`));
          }
        }, timeout);

        // Handle spawn errors (e.g., claude not found)
        this.process.on("error", (err) => {
          this.clearTimeout();
          this.cleanupSystemPromptFile();
          if (err.message.includes("ENOENT")) {
            reject(
              new Error(
                "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code"
              )
            );
          } else {
            reject(err);
          }
        });

        // Pass input via stdin to avoid E2BIG on large prompts.
        // With images, send a stream-json user message (the only way the CLI
        // accepts image content); otherwise send the prompt as plain text.
        if (options.images && options.images.length > 0) {
          const content: unknown[] = [];
          if (prompt) content.push({ type: "text", text: prompt });
          content.push(...options.images);
          const message = {
            type: "user",
            message: { role: "user", content },
          };
          this.process.stdin?.write(JSON.stringify(message) + "\n");
        } else {
          this.process.stdin?.write(prompt);
        }
        this.process.stdin?.end();

        console.error(`[Subprocess] Process spawned with PID: ${this.process.pid}`);

        // Parse JSON stream from stdout
        this.process.stdout?.on("data", (chunk: Buffer) => {
          const data = chunk.toString();
          console.error(`[Subprocess] Received ${data.length} bytes of stdout`);
          this.buffer += data;
          this.processBuffer();
        });

        // Capture stderr for debugging and for surfacing real errors (e.g.
        // "Not logged in") to the API client when the CLI exits without output.
        this.process.stderr?.on("data", (chunk: Buffer) => {
          const errorText = chunk.toString().trim();
          if (errorText) {
            this.lastStderr = errorText.slice(0, 500);
            // Don't emit as error unless it's actually an error
            // Claude CLI may write debug info to stderr
            console.error("[Subprocess stderr]:", errorText.slice(0, 200));
          }
        });

        // Handle process close
        this.process.on("close", (code) => {
          console.error(`[Subprocess] Process closed with code: ${code}`);
          this.clearTimeout();
          this.cleanupSystemPromptFile();
          // Process any remaining buffer
          if (this.buffer.trim()) {
            this.processBuffer();
          }
          this.emit("close", code);
        });

        // Resolve immediately since we're streaming
        resolve();
      } catch (err) {
        this.clearTimeout();
        reject(err);
      }
    });
  }

  /**
   * Build CLI arguments array.
   * The prompt is passed via stdin and the system prompt via a temp file
   * (--append-system-prompt-file), so neither lands on the command line.
   */
  private buildArgs(options: SubprocessOptions): string[] {
    const args = [
      "--print", // Non-interactive mode
      "--output-format",
      "stream-json", // JSON streaming output
      "--verbose", // Required for stream-json
      "--include-partial-messages", // Enable streaming chunks
      "--model",
      options.model, // Model alias (opus/sonnet/haiku)
    ];

    // Images can only be sent via stream-json input (Anthropic content blocks).
    if (options.images && options.images.length > 0) {
      args.push("--input-format", "stream-json");
    }

    args.push(
      "--no-session-persistence", // Don't save sessions to disk
      // --- Isolation: behave as a pure chat API regardless of the host ---
      "--setting-sources",
      "", // Load no user/project settings -> no hooks, no CLAUDE.md, no plugins
      "--strict-mcp-config", // Ignore the host's MCP servers (Notion, etc.)
      "--disable-slash-commands", // No skills/slash commands
      "--tools",
      "", // No built-in tools -> the proxy can never run Bash/Edit on the host
      "--dangerously-skip-permissions" // Safe: there are no tools to permit
    );

    if (this.systemPromptFile) {
      args.push("--append-system-prompt-file", this.systemPromptFile);
    }

    if (options.sessionId) {
      args.push("--session-id", options.sessionId);
    }

    return args;
  }

  /**
   * Process the buffer and emit parsed messages
   */
  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    this.buffer = lines.pop() || ""; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message: ClaudeCliMessage = JSON.parse(trimmed);
        this.emit("message", message);

        if (isContentDelta(message)) {
          // Emit content delta for streaming
          this.emit("content_delta", message as ClaudeCliStreamEvent);
        } else if (isAssistantMessage(message)) {
          this.emit("assistant", message);
        } else if (isResultMessage(message)) {
          this.emit("result", message);
        }
      } catch {
        // Non-JSON output, emit as raw
        this.emit("raw", trimmed);
      }
    }
  }

  /**
   * Clear the timeout timer
   */
  private clearTimeout(): void {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
  }

  /**
   * Delete the temp system-prompt file, if any. Best-effort; ignores errors.
   */
  private cleanupSystemPromptFile(): void {
    const file = this.systemPromptFile;
    if (file) {
      this.systemPromptFile = null;
      fs.unlink(file).catch(() => {});
    }
  }

  /**
   * Kill the subprocess
   */
  kill(signal: NodeJS.Signals = "SIGTERM"): void {
    if (!this.isKilled && this.process) {
      this.isKilled = true;
      this.clearTimeout();
      this.cleanupSystemPromptFile();
      this.process.kill(signal);
    }
  }

  /**
   * Check if the process is still running
   */
  isRunning(): boolean {
    return this.process !== null && !this.isKilled && this.process.exitCode === null;
  }

  /**
   * Last line(s) the CLI wrote to stderr (trimmed). Useful for turning an
   * opaque non-zero exit into a meaningful API error.
   */
  getLastStderr(): string {
    return this.lastStderr;
  }
}

/**
 * Verify that Claude CLI is installed and accessible
 */
export async function verifyClaude(): Promise<{ ok: boolean; error?: string; version?: string }> {
  return new Promise((resolve) => {
    const proc = spawn("claude", ["--version"], { stdio: "pipe" });
    let output = "";

    proc.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });

    proc.on("error", () => {
      resolve({
        ok: false,
        error:
          "Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-code",
      });
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({ ok: true, version: output.trim() });
      } else {
        resolve({
          ok: false,
          error: "Claude CLI returned non-zero exit code",
        });
      }
    });
  });
}

/**
 * Check if Claude CLI is authenticated
 *
 * Claude Code stores credentials in the OS keychain, not a file.
 * We verify authentication by checking if we can call the CLI successfully.
 * If the CLI is installed, it typically has valid credentials from `claude auth login`.
 */
export async function verifyAuth(): Promise<{ ok: boolean; error?: string }> {
  // If Claude CLI is installed and the user has run `claude auth login`,
  // credentials are stored in the OS keychain and will be used automatically.
  // We can't easily check the keychain, so we'll just return true if the CLI exists.
  // Authentication errors will surface when making actual API calls.
  return { ok: true };
}
