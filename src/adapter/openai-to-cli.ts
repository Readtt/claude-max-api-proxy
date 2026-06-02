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

export type ClaudeModel = "opus" | "sonnet" | "haiku";

export interface CliInput {
  prompt: string;
  model: ClaudeModel;
  systemPrompt?: string;
  sessionId?: string;
}

/**
 * Map any requested model string to a Claude CLI alias (opus/sonnet/haiku).
 *
 * Detection is by family keyword, not an explicit list, so new models work
 * with zero code changes: `claude-opus-4-8`, `anthropic/claude-opus-5`,
 * `claude-max/opus-next`, or a bare `opus` all resolve to the `opus` alias —
 * and the CLI alias always points at the latest model in that family.
 *
 * Unknown strings default to `opus` (the headline Claude Max model).
 */
export function extractModel(model: string): ClaudeModel {
  const m = (model || "").toLowerCase();
  if (m.includes("haiku")) return "haiku";
  if (m.includes("sonnet")) return "sonnet";
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
