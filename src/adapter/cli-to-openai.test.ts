import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextContent,
  cliToOpenaiChunk,
  createDoneChunk,
  cliResultToOpenai,
} from "./cli-to-openai.js";
import type { ClaudeCliAssistant, ClaudeCliResult } from "../types/claude-cli.js";

const makeAssistant = (text: string, model = "claude-sonnet-4"): ClaudeCliAssistant => ({
  type: "assistant",
  message: {
    model,
    id: "msg-test",
    type: "message",
    role: "assistant",
    content: [{ type: "text", text }],
    stop_reason: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  },
  session_id: "sess-1",
  uuid: "uuid-1",
});

const makeResult = (text: string): ClaudeCliResult => ({
  type: "result",
  subtype: "success",
  is_error: false,
  duration_ms: 1000,
  duration_api_ms: 800,
  num_turns: 1,
  result: text,
  session_id: "sess-1",
  total_cost_usd: 0.01,
  usage: { input_tokens: 100, output_tokens: 50 },
  modelUsage: {
    "claude-sonnet-4": { inputTokens: 100, outputTokens: 50, costUSD: 0.01 },
  },
});

describe("extractTextContent", () => {
  it("extracts text from content array", () => {
    const msg = makeAssistant("hello world");
    assert.equal(extractTextContent(msg), "hello world");
  });

  it("joins multiple text blocks", () => {
    const msg = makeAssistant("");
    msg.message.content = [
      { type: "text", text: "first" },
      { type: "text", text: "second" },
    ];
    assert.equal(extractTextContent(msg), "firstsecond");
  });
});

describe("cliToOpenaiChunk", () => {
  it("creates a streaming chunk", () => {
    const chunk = cliToOpenaiChunk(makeAssistant("hi"), "req-1");
    assert.equal(chunk.object, "chat.completion.chunk");
    assert.ok(chunk.id.startsWith("chatcmpl-"));
    assert.equal(chunk.choices[0].delta.content, "hi");
  });

  it("includes role on first chunk", () => {
    const chunk = cliToOpenaiChunk(makeAssistant("hi"), "req-1", true);
    assert.equal(chunk.choices[0].delta.role, "assistant");
  });

  it("omits role on non-first chunks", () => {
    const chunk = cliToOpenaiChunk(makeAssistant("hi"), "req-1", false);
    assert.equal(chunk.choices[0].delta.role, undefined);
  });

  it("uses requestedModel when provided", () => {
    const chunk = cliToOpenaiChunk(makeAssistant("hi", "claude-haiku-4"), "req-1", false, "claude-opus-4-6");
    assert.equal(chunk.model, "claude-opus-4-6");
  });
});

describe("createDoneChunk", () => {
  it("creates a stop chunk", () => {
    const chunk = createDoneChunk("req-1", "claude-sonnet-4");
    assert.equal(chunk.choices[0].finish_reason, "stop");
    assert.deepEqual(chunk.choices[0].delta, {});
  });
});

describe("cliResultToOpenai", () => {
  it("converts result to OpenAI response", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1");
    assert.equal(response.object, "chat.completion");
    assert.equal(response.choices[0].message.content, "Hello!");
    assert.equal(response.choices[0].message.role, "assistant");
    assert.equal(response.choices[0].finish_reason, "stop");
  });

  it("includes token usage", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1");
    assert.equal(response.usage.prompt_tokens, 100);
    assert.equal(response.usage.completion_tokens, 50);
    assert.equal(response.usage.total_tokens, 150);
  });

  it("uses requestedModel when provided (normalized)", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1", "claude-max/claude-opus-4-6");
    // normalizeModelName extracts "opus" → "claude-opus-4"
    assert.equal(response.model, "claude-opus-4");
  });

  it("normalizes model from modelUsage when no requestedModel", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1");
    assert.equal(response.model, "claude-sonnet-4");
  });
});
