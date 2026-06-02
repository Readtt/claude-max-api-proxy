/**
 * Types for the OpenAI-compatible Chat Completions API.
 * Only the fields the proxy reads are modelled; unknown fields are tolerated
 * (see the index signature on OpenAIChatRequest) so clients never 400 on
 * params the CLI can't honor.
 */

export interface OpenAIContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string; detail?: string };
}

/** A tool/function call emitted by the assistant. `arguments` is a JSON string. */
export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "function";
  content: string | OpenAIContentPart[] | null;
  /** Tool/function name (for role "tool"/"function", or named participants). */
  name?: string;
  /** Present on assistant messages that called tools. */
  tool_calls?: OpenAIToolCall[];
  /** Present on role "tool" messages: which call this is the result of. */
  tool_call_id?: string;
}

export interface OpenAIFunctionDef {
  name: string;
  description?: string;
  /** JSON Schema for the function arguments. */
  parameters?: Record<string, unknown>;
}

export interface OpenAITool {
  type: "function";
  function: OpenAIFunctionDef;
}

export type OpenAIToolChoice =
  | "none"
  | "auto"
  | "required"
  | { type: "function"; function: { name: string } };

export interface OpenAIResponseFormat {
  type: "text" | "json_object" | "json_schema";
  json_schema?: {
    name?: string;
    description?: string;
    schema?: Record<string, unknown>;
    strict?: boolean;
  };
}

export interface OpenAIChatRequest {
  model: string;
  messages: OpenAIChatMessage[];
  stream?: boolean;
  // Sampling params: accepted for compatibility. The Claude CLI does not expose
  // these, so they are ignored (documented in COMPATIBILITY.md).
  temperature?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[];
  seed?: number;
  n?: number;
  logprobs?: boolean;
  // Supported via emulation:
  tools?: OpenAITool[];
  tool_choice?: OpenAIToolChoice;
  response_format?: OpenAIResponseFormat;
  user?: string; // Used for session mapping
  /** Tolerate any other OpenAI params without failing. */
  [key: string]: unknown;
}

export interface OpenAIChatResponseChoice {
  index: number;
  message: {
    role: "assistant";
    content: string | null;
    tool_calls?: OpenAIToolCall[];
  };
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface OpenAIChatResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: OpenAIChatResponseChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  type?: "function";
  function?: { name?: string; arguments?: string };
}

export interface OpenAIChatChunkDelta {
  role?: "assistant";
  content?: string;
  tool_calls?: OpenAIToolCallDelta[];
}

export interface OpenAIChatChunkChoice {
  index: number;
  delta: OpenAIChatChunkDelta;
  finish_reason: "stop" | "length" | "content_filter" | "tool_calls" | null;
}

export interface OpenAIChatChunk {
  id: string;
  object: "chat.completion.chunk";
  created: number;
  model: string;
  choices: OpenAIChatChunkChoice[];
}

export interface OpenAIModel {
  id: string;
  object: "model";
  owned_by: string;
  created?: number;
}

export interface OpenAIModelList {
  object: "list";
  data: OpenAIModel[];
}

export interface OpenAIError {
  error: {
    message: string;
    type: string;
    code: string | null;
  };
}
