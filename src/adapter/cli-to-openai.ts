/**
 * Converts Claude CLI output to OpenAI-compatible response format
 */

import type { ClaudeCliAssistant, ClaudeCliResult } from "../types/claude-cli.js";
import type {
  OpenAIChatResponse,
  OpenAIChatChunk,
  OpenAIToolCall,
} from "../types/openai.js";

/**
 * Extract text content from Claude CLI assistant message
 */
export function extractTextContent(message: ClaudeCliAssistant): string {
  return message.message.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
}

/**
 * Map the CLI's `stop_reason` to an OpenAI `finish_reason`. Tool calls are
 * handled separately (the caller sets "tool_calls"); this covers text replies.
 */
export function mapFinishReason(
  stopReason: string | null | undefined
): "stop" | "length" | "content_filter" {
  switch (stopReason) {
    case "max_tokens":
      return "length";
    case "refusal":
      return "content_filter";
    // end_turn, stop_sequence, null, or anything unexpected → a normal stop.
    default:
      return "stop";
  }
}

/**
 * Create a final "done" chunk for streaming. The model is echoed verbatim so it
 * matches what the client requested (and the earlier content chunks).
 */
export function createDoneChunk(
  requestId: string,
  model: string,
  finishReason: "stop" | "length" | "content_filter" | "tool_calls" = "stop"
): OpenAIChatChunk {
  return {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}

/**
 * Convert Claude CLI result to OpenAI non-streaming response.
 *
 * When `toolCalls` are supplied (the model emitted an emulated tool call),
 * the message content is null and finish_reason is "tool_calls", matching the
 * OpenAI function-calling contract.
 */
export function cliResultToOpenai(
  result: ClaudeCliResult,
  requestId: string,
  requestedModel?: string,
  toolCalls?: OpenAIToolCall[]
): OpenAIChatResponse {
  // Echo the requested model verbatim so the response matches the request.
  // Only fall back to the CLI-reported model (normalized) when none was given.
  const modelName = requestedModel
    ? requestedModel
    : normalizeModelName(
        result.modelUsage ? Object.keys(result.modelUsage)[0] : "claude-sonnet-4"
      );

  const hasToolCalls = !!toolCalls && toolCalls.length > 0;

  return {
    id: `chatcmpl-${requestId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelName,
    choices: [
      {
        index: 0,
        message: hasToolCalls
          ? { role: "assistant", content: null, tool_calls: toolCalls }
          : { role: "assistant", content: result.result },
        finish_reason: hasToolCalls
          ? "tool_calls"
          : mapFinishReason(result.stop_reason),
      },
    ],
    usage: {
      prompt_tokens: result.usage?.input_tokens || 0,
      completion_tokens: result.usage?.output_tokens || 0,
      total_tokens:
        (result.usage?.input_tokens || 0) + (result.usage?.output_tokens || 0),
    },
  };
}

/**
 * Normalize Claude model names to a consistent format
 * e.g., "claude-sonnet-4-5-20250929" -> "claude-sonnet-4"
 */
function normalizeModelName(model: string): string {
  if (model.includes("opus")) return "claude-opus-4";
  if (model.includes("sonnet")) return "claude-sonnet-4";
  if (model.includes("haiku")) return "claude-haiku-4";
  return model;
}
