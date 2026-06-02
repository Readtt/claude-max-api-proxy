/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type {
  OpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIContentPart,
} from "../types/openai.js";
import { buildToolingSystemPrompt } from "./tools.js";
import { resolveModelArg, type ClaudeModel } from "../models.js";

// Re-exported for backwards compatibility; model resolution lives in models.ts.
export { resolveModelArg as extractModel } from "../models.js";
export type { ClaudeModel } from "../models.js";

/** Reasoning effort levels the CLI accepts via --effort. */
const VALID_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof VALID_EFFORTS)[number];

/** Validate an OpenAI `reasoning_effort` value; undefined if absent/invalid. */
export function extractReasoningEffort(value: unknown): ReasoningEffort | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.toLowerCase();
  return (VALID_EFFORTS as readonly string[]).includes(v)
    ? (v as ReasoningEffort)
    : undefined;
}

/**
 * Extract text from message content, which can be a string, an array of
 * content parts (OpenAI format), or null (e.g. an assistant tool-call message).
 * Image parts are handled separately (see extractImages) and skipped here.
 */
function extractText(content: string | OpenAIContentPart[] | null | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text as string)
      .join("\n");
  }
  return String(content);
}

/** An Anthropic-format image content block, as the CLI accepts on stdin. */
export interface AnthropicImageBlock {
  type: "image";
  source:
    | { type: "base64"; media_type: string; data: string }
    | { type: "url"; url: string };
}

/**
 * Collect image content parts from all messages and convert OpenAI `image_url`
 * entries into Anthropic image blocks. Handles both `data:` URLs (base64) and
 * remote http(s) URLs. Returns [] when there are no images.
 */
export function extractImages(messages: OpenAIChatRequest["messages"]): AnthropicImageBlock[] {
  const images: AnthropicImageBlock[] = [];
  for (const msg of messages) {
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part.type !== "image_url" || !part.image_url?.url) continue;
      const block = imageUrlToBlock(part.image_url.url);
      if (block) images.push(block);
    }
  }
  return images;
}

function imageUrlToBlock(url: string): AnthropicImageBlock | null {
  const data = url.match(/^data:([^;,]+);base64,(.*)$/s);
  if (data) {
    return {
      type: "image",
      source: { type: "base64", media_type: data[1], data: data[2] },
    };
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: "image", source: { type: "url", url } };
  }
  return null; // unsupported (e.g. bare base64 without data: prefix)
}

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  systemPrompt?: string;
  reasoningEffort?: ReasoningEffort;
  images?: AnthropicImageBlock[];
}

/**
 * Extract system messages from OpenAI messages array.
 * Returns the concatenated system prompt text, or undefined if none.
 */
export function extractSystemPrompt(messages: OpenAIChatRequest["messages"]): string | undefined {
  const systemParts: string[] = [];
  for (const msg of messages) {
    if (msg.role === "system" || msg.role === "developer") {
      systemParts.push(extractText(msg.content));
    }
  }
  return systemParts.length > 0 ? systemParts.join("\n") : undefined;
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * System messages are extracted separately (passed via --append-system-prompt).
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const text = extractText(msg.content);
    switch (msg.role) {
      case "system":
      case "developer":
        // System messages handled via the system prompt file, skip here
        break;

      case "user":
        // User messages are the main prompt
        if (text) parts.push(text);
        break;

      case "assistant": {
        // Previous assistant turn — include any tool calls it made so the
        // model has the full conversation context.
        const segments: string[] = [];
        if (text) segments.push(text);
        if (msg.tool_calls && msg.tool_calls.length > 0) {
          const calls = msg.tool_calls.map((c) => ({
            name: c.function.name,
            arguments: safeJsonParse(c.function.arguments),
          }));
          segments.push("```tool_calls\n" + JSON.stringify(calls) + "\n```");
        }
        parts.push(
          `<previous_response>\n${segments.join("\n")}\n</previous_response>\n`
        );
        break;
      }

      case "tool":
      case "function": {
        // A tool result being fed back in.
        const idAttr = msg.tool_call_id ? ` tool_call_id="${msg.tool_call_id}"` : "";
        const nameAttr = msg.name ? ` name="${msg.name}"` : "";
        parts.push(`<tool_result${nameAttr}${idAttr}>\n${text}\n</tool_result>\n`);
        break;
      }
    }
  }

  return parts.join("\n").trim();
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/**
 * Convert OpenAI chat request to CLI input format.
 *
 * The system prompt sent to the CLI is the caller's system/developer messages
 * plus any emulated tooling/response_format instructions.
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  const userSystem = extractSystemPrompt(request.messages);
  const tooling = buildToolingSystemPrompt(
    request.tools,
    request.tool_choice,
    request.response_format
  );
  const systemPrompt = [userSystem, tooling].filter(Boolean).join("\n\n");

  const images = extractImages(request.messages);

  return {
    prompt: messagesToPrompt(request.messages),
    model: resolveModelArg(request.model),
    systemPrompt: systemPrompt || undefined,
    reasoningEffort: extractReasoningEffort(request.reasoning_effort),
    images: images.length > 0 ? images : undefined,
  };
}

/** True when the request asked for tools and tool_choice didn't forbid them. */
export function wantsToolCalls(request: OpenAIChatRequest): boolean {
  return (
    Array.isArray(request.tools) &&
    request.tools.length > 0 &&
    request.tool_choice !== "none"
  );
}

// extractText is exported for reuse/testing of content handling.
export { extractText };
