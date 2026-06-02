/**
 * OpenAI tool-calling and response_format emulation.
 *
 * The Claude Code CLI does not expose OpenAI-style function calling or a
 * "return JSON" mode directly, so we emulate both by:
 *   1. Injecting instructions + the tool/schema definitions into the system
 *      prompt (see buildToolingSystemPrompt).
 *   2. Parsing the model's reply back into OpenAI tool_calls (see
 *      parseToolCalls).
 *
 * Emulation is reliable with Claude but not byte-for-byte guaranteed; see
 * COMPATIBILITY.md.
 */

import { randomBytes } from "crypto";
import type {
  OpenAITool,
  OpenAIToolChoice,
  OpenAIResponseFormat,
  OpenAIToolCall,
} from "../types/openai.js";

/** Marker fence the model is told to use when calling tools. */
const TOOL_CALL_FENCE = "tool_calls";

export function generateToolCallId(): string {
  return `call_${randomBytes(12).toString("hex")}`;
}

/**
 * Build the system-prompt addendum that teaches the model how to call the
 * given tools and obey tool_choice. Returns "" when there are no tools.
 */
export function buildToolingSystemPrompt(
  tools?: OpenAITool[],
  toolChoice?: OpenAIToolChoice,
  responseFormat?: OpenAIResponseFormat
): string {
  const parts: string[] = [];

  if (tools && tools.length > 0) {
    const list = tools
      .filter((t) => t.type === "function" && t.function?.name)
      .map((t) => {
        const f = t.function;
        const schema = f.parameters ? JSON.stringify(f.parameters) : "{}";
        return `- ${f.name}: ${f.description || "(no description)"}\n  parameters (JSON Schema): ${schema}`;
      })
      .join("\n");

    parts.push(
      [
        "# Tool use",
        "",
        "You can call the tools/functions below. To call one or more, reply with ONLY a fenced code block tagged `" +
          TOOL_CALL_FENCE +
          "` that contains a JSON array of calls, and nothing else:",
        "",
        "```" + TOOL_CALL_FENCE,
        '[{"name": "<tool_name>", "arguments": { /* args matching the schema */ }}]',
        "```",
        "",
        'Each "arguments" value MUST be a JSON object that matches that tool\'s parameters schema. You may include multiple calls in the array. Do not add any prose before or after the block when calling tools.',
        "",
        "Available tools:",
        list,
      ].join("\n")
    );

    // tool_choice
    if (toolChoice === "none") {
      parts.push(
        "For this turn, do NOT call any tool. Answer the user directly in plain text."
      );
    } else if (toolChoice === "required") {
      parts.push(
        "For this turn, you MUST call at least one tool. Reply with ONLY the `" +
          TOOL_CALL_FENCE +
          "` block."
      );
    } else if (
      toolChoice &&
      typeof toolChoice === "object" &&
      toolChoice.type === "function"
    ) {
      parts.push(
        `For this turn, you MUST call the function \`${toolChoice.function.name}\`. Reply with ONLY the \`${TOOL_CALL_FENCE}\` block calling it.`
      );
    } else {
      parts.push(
        "Call a tool only when it helps answer the request; otherwise answer in plain text."
      );
    }
  }

  const rf = buildResponseFormatInstruction(responseFormat);
  if (rf) parts.push(rf);

  return parts.join("\n\n");
}

/** Instruction text for response_format (JSON object / JSON schema). */
export function buildResponseFormatInstruction(
  responseFormat?: OpenAIResponseFormat
): string {
  if (!responseFormat) return "";
  if (responseFormat.type === "json_object") {
    return "# Output format\n\nRespond with ONLY a single valid JSON value. No markdown, no code fences, no commentary.";
  }
  if (responseFormat.type === "json_schema") {
    const schema = responseFormat.json_schema?.schema
      ? JSON.stringify(responseFormat.json_schema.schema)
      : "{}";
    return (
      "# Output format\n\nRespond with ONLY a single valid JSON value that conforms to this JSON Schema. No markdown, no code fences, no commentary:\n\n" +
      schema
    );
  }
  return "";
}

/**
 * Parse a model reply into tool calls.
 *
 * Looks for a ```tool_calls fenced block first, then falls back to a bare
 * JSON array/object that looks like calls. Returns null when no tool call is
 * present (i.e. the reply is a normal text answer).
 */
export function parseToolCalls(text: string): OpenAIToolCall[] | null {
  if (!text) return null;

  const candidates: string[] = [];

  // 1. Preferred: a fenced ```tool_calls block.
  const fenceRe = new RegExp(
    "```" + TOOL_CALL_FENCE + "\\s*([\\s\\S]*?)```",
    "i"
  );
  const fenced = text.match(fenceRe);
  if (fenced) candidates.push(fenced[1]);

  // 2. Any generic fenced block (```json ... ``` or ``` ... ```).
  if (candidates.length === 0) {
    const generic = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (generic) candidates.push(generic[1]);
  }

  // 3. The whole trimmed reply (model returned raw JSON).
  const trimmed = text.trim();
  if (
    candidates.length === 0 &&
    (trimmed.startsWith("[") || trimmed.startsWith("{"))
  ) {
    candidates.push(trimmed);
  }

  for (const raw of candidates) {
    const calls = coerceCalls(raw);
    if (calls && calls.length > 0) return calls;
  }
  return null;
}

/**
 * For response_format JSON modes: strip a surrounding markdown code fence if
 * the model added one (it sometimes does despite instructions), so the client
 * receives parseable JSON. Best-effort — does not validate.
 */
export function extractJsonContent(text: string): string {
  if (!text) return text;
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : text).trim();
}

function coerceCalls(raw: string): OpenAIToolCall[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return null;
  }

  const arr = Array.isArray(parsed) ? parsed : [parsed];
  const calls: OpenAIToolCall[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") return null;
    const obj = item as Record<string, unknown>;
    // Accept {name, arguments} or OpenAI-shaped {function:{name, arguments}}.
    const fn = (obj.function as Record<string, unknown>) || obj;
    const name = fn.name;
    if (typeof name !== "string" || !name) return null;
    let args = fn.arguments;
    if (args === undefined) args = (obj as Record<string, unknown>).arguments;
    const argString =
      typeof args === "string" ? args : JSON.stringify(args ?? {});
    calls.push({
      id: generateToolCallId(),
      type: "function",
      function: { name, arguments: argString },
    });
  }
  return calls.length > 0 ? calls : null;
}
