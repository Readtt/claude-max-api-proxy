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
  sessionId?: string;
}

const MODEL_MAP: Record<string, ClaudeModel> = {
  // Direct model names
  "claude-opus-4": "opus",
  "claude-opus-4-6": "opus",
  "claude-sonnet-4": "sonnet",
  "claude-haiku-4": "haiku",
  // With provider prefix
  "claude-code-cli/claude-opus-4": "opus",
  "claude-code-cli/claude-opus-4-6": "opus",
  "claude-code-cli/claude-sonnet-4": "sonnet",
  "claude-code-cli/claude-haiku-4": "haiku",
  // Anthropic-style model IDs (used by OpenClaw)
  "anthropic/claude-opus-4-6": "opus",
  "anthropic/claude-opus-4": "opus",
  "anthropic/claude-sonnet-4": "sonnet",
  "anthropic/claude-haiku-4": "haiku",
  // Claude Max provider prefix (used by OpenClaw)
  "claude-max/claude-opus-4-6": "opus",
  "claude-max/claude-opus-4": "opus",
  "claude-max/claude-sonnet-4": "sonnet",
  "claude-max/claude-haiku-4": "haiku",
  // Aliases
  "opus": "opus",
  "sonnet": "sonnet",
  "haiku": "haiku",
};

/**
 * Extract Claude model alias from request model string
 */
export function extractModel(model: string): ClaudeModel {
  // Try direct lookup
  if (MODEL_MAP[model]) {
    return MODEL_MAP[model];
  }

  // Try stripping provider prefix
  const stripped = model.replace(/^claude-code-cli\//, "");
  if (MODEL_MAP[stripped]) {
    return MODEL_MAP[stripped];
  }

  // Default to opus (Claude Max subscription)
  return "opus";
}

/**
 * Convert OpenAI messages array to a single prompt string for Claude CLI
 *
 * Claude Code CLI in --print mode expects a single prompt, not a conversation.
 * We format the messages into a readable format that preserves context.
 */
export function messagesToPrompt(messages: OpenAIChatRequest["messages"]): string {
  const parts: string[] = [];

  for (const msg of messages) {
    const text = extractText(msg.content);
    switch (msg.role) {
      case "system":
        // System messages become context instructions
        parts.push(`<system>\n${text}\n</system>\n`);
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
    sessionId: request.user, // Use OpenAI's user field for session mapping
  };
}
