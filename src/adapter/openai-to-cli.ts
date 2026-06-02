/**
 * Converts OpenAI chat request format to Claude CLI input
 */

import type { OpenAIChatRequest, OpenAIContentPart } from "../types/openai.js";

/**
 * Extract text from message content which can be either a string
 * or an array of content parts (OpenAI format).
 */
function extractText(content: string | OpenAIContentPart[]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text!)
      .join("\n");
  }
  // Fallback: try to stringify
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
        // System messages handled via --append-system-prompt, skip here
        break;

      case "user":
        // User messages are the main prompt
        parts.push(text);
        break;

      case "assistant":
        // Previous assistant responses for context
        parts.push(`<previous_response>\n${text}\n</previous_response>\n`);
        break;
    }
  }

  return parts.join("\n").trim();
}

/**
 * Convert OpenAI chat request to CLI input format
 */
export function openaiToCli(request: OpenAIChatRequest): CliInput {
  return {
    prompt: messagesToPrompt(request.messages),
    model: extractModel(request.model),
    systemPrompt: extractSystemPrompt(request.messages),
    sessionId: request.user, // Use OpenAI's user field for session mapping
  };
}
