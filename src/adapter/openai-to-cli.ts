/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type {
  OpenAIChatRequest,
  OpenAIChatMessage,
  OpenAIContentPart,
} from "../types/openai.js";
import { buildToolingSystemPrompt } from "./tools.js";

/**
 * Extract text from message content, which can be a string, an array of
 * content parts (OpenAI format), or null (e.g. an assistant tool-call message).
 * Image parts are noted as placeholders — the CLI's text interface can't take
 * image bytes (see COMPATIBILITY.md).
 */
function extractText(content: string | OpenAIContentPart[] | null | undefined): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (part.type === "text" && part.text) return part.text;
        if (part.type === "image_url") return "[image omitted: this proxy is text-only]";
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return String(content);
}

// A value accepted by `claude --model`: a family alias (opus/sonnet/haiku,
// which resolves to the latest in that family) or a full model ID
// (e.g. claude-opus-4-7) which pins that exact version.
export type ClaudeModel = string;

const PROVIDER_PREFIXES = ["anthropic/", "claude-max/", "claude-code-cli/"];

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  systemPrompt?: string;
  sessionId?: string;
}

/**
 * Resolve a requested model string to a value for `claude --model`.
 *
 * Two behaviours, so clients can either ride the latest model or pin one:
 *   - A full version ID (family + at least major.minor, e.g.
 *     `claude-opus-4-7`, `claude-sonnet-4-5-20250929`) is passed through
 *     verbatim so the CLI runs that exact version. Provider prefixes
 *     (`anthropic/`, `claude-max/`, `claude-code-cli/`) are stripped first.
 *   - Anything else maps to the family alias (`opus`/`sonnet`/`haiku`), which
 *     the CLI resolves to the latest model in that family. This covers bare
 *     aliases, major-only names like `claude-opus-4` (not a valid full ID),
 *     and unknown names.
 *
 * New models therefore need no code change: pin them by full ID, or get the
 * newest automatically via the alias. Non-Claude names default to `opus`.
 */
export function extractModel(model: string): ClaudeModel {
  let m = (model || "").trim();
  for (const prefix of PROVIDER_PREFIXES) {
    if (m.startsWith(prefix)) {
      m = m.slice(prefix.length);
      break;
    }
  }

  // Pin a specific version when the ID carries a family + major-minor version.
  if (/^claude-(opus|sonnet|haiku)-\d+-\d+/i.test(m)) {
    return m;
  }

  // Otherwise pick the family's latest via its alias.
  const lower = m.toLowerCase();
  if (lower.includes("haiku")) return "haiku";
  if (lower.includes("sonnet")) return "sonnet";
  return "opus";
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

  return {
    prompt: messagesToPrompt(request.messages),
    model: extractModel(request.model),
    systemPrompt: systemPrompt || undefined,
    sessionId: request.user, // Use OpenAI's user field for session mapping
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
