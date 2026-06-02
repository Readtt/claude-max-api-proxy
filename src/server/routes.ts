/**
 * API Route Handlers
 *
 * Implements OpenAI-compatible endpoints for Clawdbot integration
 */

import type { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { ClaudeSubprocess } from "../subprocess/manager.js";
import { openaiToCli, wantsToolCalls } from "../adapter/openai-to-cli.js";
import { parseToolCalls, extractJsonContent } from "../adapter/tools.js";
import {
  cliResultToOpenai,
  createDoneChunk,
} from "../adapter/cli-to-openai.js";
import type { OpenAIChatRequest } from "../types/openai.js";
import type { ClaudeCliAssistant, ClaudeCliResult, ClaudeCliStreamEvent } from "../types/claude-cli.js";
import { usageTracker } from "../usage/tracker.js";
import { isAuthEnabled } from "./auth.js";

/**
 * Build a useful error message when the CLI exits without a response.
 * Surfaces the CLI's stderr (e.g. "Not logged in · Please run /login") so the
 * caller sees the real cause instead of a bare exit code.
 */
function exitErrorMessage(code: number | null, stderr: string): string {
  const base = `Claude CLI exited with code ${code} without a response`;
  const detail = stderr.trim();
  if (!detail) return base;
  if (/not logged in|\/login|authenticat/i.test(detail)) {
    return `Claude CLI is not authenticated. Run \`claude\` once to log in. (CLI: ${detail})`;
  }
  return `${base}: ${detail}`;
}

/**
 * Handle POST /v1/chat/completions
 *
 * Main endpoint for chat requests, supports both streaming and non-streaming
 */
export async function handleChatCompletions(
  req: Request,
  res: Response
): Promise<void> {
  const requestId = uuidv4().replace(/-/g, "").slice(0, 24);
  const body = req.body as OpenAIChatRequest;
  const stream = body.stream === true;
  const requestedModel = body.model || "claude-opus-4-8";
  const startTime = Date.now();

  try {
    // Validate request
    if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
      res.status(400).json({
        error: {
          message: "messages is required and must be a non-empty array",
          type: "invalid_request_error",
          code: "invalid_messages",
        },
      });
      return;
    }

    // Convert to CLI input format
    const cliInput = openaiToCli(body);
    const subprocess = new ClaudeSubprocess();
    const parseTools = wantsToolCalls(body);
    const rf = body.response_format?.type;
    const jsonMode = rf === "json_object" || rf === "json_schema";

    if (stream) {
      await handleStreamingResponse(req, res, subprocess, cliInput, requestId, requestedModel, startTime, parseTools, jsonMode);
    } else {
      await handleNonStreamingResponse(res, subprocess, cliInput, requestId, requestedModel, startTime, parseTools, jsonMode);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[handleChatCompletions] Error:", message);

    usageTracker.record({
      model: requestedModel,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - startTime,
      stream,
      success: false,
    });

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message,
          type: "server_error",
          code: null,
        },
      });
    }
  }
}

/**
 * Handle streaming response (SSE)
 *
 * IMPORTANT: The Express req.on("close") event fires when the request body
 * is fully received, NOT when the client disconnects. For SSE connections,
 * we use res.on("close") to detect actual client disconnection.
 */
async function handleStreamingResponse(
  req: Request,
  res: Response,
  subprocess: ClaudeSubprocess,
  cliInput: ReturnType<typeof openaiToCli>,
  requestId: string,
  requestedModel: string,
  startTime: number,
  parseTools: boolean,
  jsonMode: boolean
): Promise<void> {
  // Tool calls and JSON mode require the full reply before we can shape it,
  // so we buffer instead of streaming raw deltas in those cases.
  const buffer = parseTools || jsonMode;
  // Set SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Request-Id", requestId);

  // CRITICAL: Flush headers immediately to establish SSE connection
  // Without this, headers are buffered and client times out waiting
  res.flushHeaders();

  // Send initial comment to confirm connection is alive
  res.write(":ok\n\n");

  return new Promise<void>((resolve, reject) => {
    let isFirst = true;
    let lastModel = requestedModel;
    let isComplete = false;

    // Handle actual client disconnect (response stream closed)
    res.on("close", () => {
      if (!isComplete) {
        // Client disconnected before response completed - kill subprocess
        subprocess.kill();
      }
      resolve();
    });

    const created = () => Math.floor(Date.now() / 1000);
    const sendChunk = (choice: object) => {
      res.write(
        `data: ${JSON.stringify({
          id: `chatcmpl-${requestId}`,
          object: "chat.completion.chunk",
          created: created(),
          model: requestedModel,
          choices: [choice],
        })}\n\n`
      );
    };

    // Handle streaming content deltas. Only forward visible text — never
    // thinking_delta (extended-thinking) content, which has no `.text`.
    //
    // When tools are in play we cannot stream raw text: the reply may be a
    // tool-call JSON block that must come back as tool_calls, not content. So
    // we buffer and decide once the full result arrives.
    subprocess.on("content_delta", (event: ClaudeCliStreamEvent) => {
      if (buffer) return; // buffered; handled in "result"
      const delta = event.event.delta;
      const text = delta?.type === "text_delta" ? delta.text || "" : "";
      if (text && !res.writableEnded) {
        sendChunk({
          index: 0,
          delta: { role: isFirst ? "assistant" : undefined, content: text },
          finish_reason: null,
        });
        isFirst = false;
      }
    });

    // Handle final assistant message
    subprocess.on("assistant", (_message: ClaudeCliAssistant) => {
      // We use requestedModel instead of CLI-returned model
    });

    subprocess.on("result", (result: ClaudeCliResult) => {
      isComplete = true;

      // Track usage
      usageTracker.record({
        model: requestedModel,
        inputTokens: result.usage?.input_tokens || 0,
        outputTokens: result.usage?.output_tokens || 0,
        cacheReadTokens: result.usage?.cache_read_input_tokens || 0,
        cacheWriteTokens: result.usage?.cache_creation_input_tokens || 0,
        durationMs: Date.now() - startTime,
        stream: true,
        success: true,
      });

      if (!res.writableEnded) {
        const toolCalls = parseTools ? parseToolCalls(result.result) : null;

        if (toolCalls && toolCalls.length > 0) {
          // Emit the tool calls in one delta, then close with tool_calls.
          sendChunk({
            index: 0,
            delta: {
              role: "assistant",
              tool_calls: toolCalls.map((c, i) => ({
                index: i,
                id: c.id,
                type: "function",
                function: { name: c.function.name, arguments: c.function.arguments },
              })),
            },
            finish_reason: null,
          });
          sendChunk({ index: 0, delta: {}, finish_reason: "tool_calls" });
        } else {
          // Buffered (tools or JSON mode) with no tool call -> emit text now.
          if (buffer) {
            const text = jsonMode ? extractJsonContent(result.result) : result.result;
            if (text) {
              sendChunk({
                index: 0,
                delta: { role: "assistant", content: text },
                finish_reason: null,
              });
            }
          }
          const doneChunk = createDoneChunk(requestId, lastModel);
          res.write(`data: ${JSON.stringify(doneChunk)}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    subprocess.on("error", (error: Error) => {
      console.error("[Streaming] Error:", error.message);

      usageTracker.record({
        model: requestedModel,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        stream: true,
        success: false,
      });

      if (!res.writableEnded) {
        res.write(
          `data: ${JSON.stringify({
            error: { message: error.message, type: "server_error", code: null },
          })}\n\n`
        );
        res.end();
      }
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      // Subprocess exited - ensure response is closed
      if (!res.writableEnded) {
        if (code !== 0 && !isComplete) {
          // Abnormal exit without result - send error (include stderr if any)
          res.write(`data: ${JSON.stringify({
            error: { message: exitErrorMessage(code, subprocess.getLastStderr()), type: "server_error", code: null },
          })}\n\n`);
        }
        res.write("data: [DONE]\n\n");
        res.end();
      }
      resolve();
    });

    // Start the subprocess
    subprocess.start(cliInput.prompt, {
      model: cliInput.model,
      systemPrompt: cliInput.systemPrompt,
      sessionId: cliInput.sessionId,
      images: cliInput.images,
    }).catch((err) => {
      console.error("[Streaming] Subprocess start error:", err);
      reject(err);
    });
  });
}

/**
 * Handle non-streaming response
 */
async function handleNonStreamingResponse(
  res: Response,
  subprocess: ClaudeSubprocess,
  cliInput: ReturnType<typeof openaiToCli>,
  requestId: string,
  requestedModel: string,
  startTime: number,
  parseTools: boolean,
  jsonMode: boolean
): Promise<void> {
  return new Promise((resolve) => {
    let finalResult: ClaudeCliResult | null = null;

    subprocess.on("result", (result: ClaudeCliResult) => {
      finalResult = result;
    });

    subprocess.on("error", (error: Error) => {
      console.error("[NonStreaming] Error:", error.message);

      usageTracker.record({
        model: requestedModel,
        inputTokens: 0,
        outputTokens: 0,
        durationMs: Date.now() - startTime,
        stream: false,
        success: false,
      });

      res.status(500).json({
        error: {
          message: error.message,
          type: "server_error",
          code: null,
        },
      });
      resolve();
    });

    subprocess.on("close", (code: number | null) => {
      if (finalResult) {
        // Track usage
        usageTracker.record({
          model: requestedModel,
          inputTokens: finalResult.usage?.input_tokens || 0,
          outputTokens: finalResult.usage?.output_tokens || 0,
          cacheReadTokens: finalResult.usage?.cache_read_input_tokens || 0,
          cacheWriteTokens: finalResult.usage?.cache_creation_input_tokens || 0,
          durationMs: Date.now() - startTime,
          stream: false,
          success: true,
        });

        const toolCalls = parseTools ? parseToolCalls(finalResult.result) : null;
        if (jsonMode && !toolCalls) {
          finalResult.result = extractJsonContent(finalResult.result);
        }
        res.json(
          cliResultToOpenai(finalResult, requestId, requestedModel, toolCalls || undefined)
        );
      } else if (!res.headersSent) {
        usageTracker.record({
          model: requestedModel,
          inputTokens: 0,
          outputTokens: 0,
          durationMs: Date.now() - startTime,
          stream: false,
          success: false,
        });

        res.status(500).json({
          error: {
            message: exitErrorMessage(code, subprocess.getLastStderr()),
            type: "server_error",
            code: null,
          },
        });
      }
      resolve();
    });

    // Start the subprocess
    subprocess
      .start(cliInput.prompt, {
        model: cliInput.model,
        systemPrompt: cliInput.systemPrompt,
        sessionId: cliInput.sessionId,
        images: cliInput.images,
      })
      .catch((error) => {
        res.status(500).json({
          error: {
            message: error.message,
            type: "server_error",
            code: null,
          },
        });
        resolve();
      });
  });
}

/**
 * Handle GET /v1/models
 *
 * Returns available models
 */
export function handleModels(_req: Request, res: Response): void {
  const created = Math.floor(Date.now() / 1000);
  const ids = [
    "claude-opus-4-8",
    "claude-opus-4",
    "claude-sonnet-4-6",
    "claude-sonnet-4",
    "claude-haiku-4-5-20251001",
    "claude-haiku-4",
  ];

  res.json({
    object: "list",
    data: ids.map((id) => ({
      id,
      object: "model",
      owned_by: "anthropic",
      created,
    })),
  });
}

/**
 * Handle GET /v1/usage
 *
 * Returns usage statistics and estimated cost savings
 */
export function handleUsage(req: Request, res: Response): void {
  const since = req.query.since ? parseInt(req.query.since as string, 10) : undefined;
  const summary = usageTracker.getSummary(since);

  res.json({
    ...summary,
    maxSubscriptionCostUsd: 200,
    note: "estimatedApiCostSavedUsd shows what these requests would have cost via Anthropic API",
  });
}

/**
 * Handle GET /v1/usage/recent
 *
 * Returns recent request records
 */
export function handleUsageRecent(req: Request, res: Response): void {
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 20;
  const records = usageTracker.getRecent(limit);

  res.json({
    object: "list",
    data: records,
  });
}

/**
 * Handle GET /health
 *
 * Health check endpoint
 */
export function handleHealth(_req: Request, res: Response): void {
  const summary = usageTracker.getSummary();

  res.json({
    status: "ok",
    provider: "claude-code-cli",
    version: "1.4.0",
    auth: isAuthEnabled() ? "enabled" : "disabled",
    usage: {
      totalRequests: summary.totalRequests,
      estimatedSavingsUsd: summary.estimatedApiCostSavedUsd,
    },
    timestamp: new Date().toISOString(),
  });
}
