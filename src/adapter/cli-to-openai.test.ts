import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  extractTextContent,
  createDoneChunk,
  cliResultToOpenai,
  mapFinishReason,
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

describe("createDoneChunk", () => {
  it("creates a stop chunk", () => {
    const chunk = createDoneChunk("req-1", "claude-sonnet-4");
    assert.equal(chunk.choices[0].finish_reason, "stop");
    assert.deepEqual(chunk.choices[0].delta, {});
  });

  it("echoes the model verbatim and honors the finish_reason", () => {
    const chunk = createDoneChunk("req-1", "claude-opus-4-8", "length");
    assert.equal(chunk.model, "claude-opus-4-8");
    assert.equal(chunk.choices[0].finish_reason, "length");
  });
});

describe("mapFinishReason", () => {
  it("maps known stop reasons", () => {
    assert.equal(mapFinishReason("end_turn"), "stop");
    assert.equal(mapFinishReason("stop_sequence"), "stop");
    assert.equal(mapFinishReason("max_tokens"), "length");
    assert.equal(mapFinishReason("refusal"), "content_filter");
  });

  it("defaults to stop for null/unknown", () => {
    assert.equal(mapFinishReason(null), "stop");
    assert.equal(mapFinishReason(undefined), "stop");
    assert.equal(mapFinishReason("weird"), "stop");
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

  it("echoes requestedModel verbatim (matches what the client sent)", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1", "claude-max/claude-opus-4-6");
    assert.equal(response.model, "claude-max/claude-opus-4-6");
  });

  it("normalizes model from modelUsage when no requestedModel", () => {
    const response = cliResultToOpenai(makeResult("Hello!"), "req-1");
    assert.equal(response.model, "claude-sonnet-4");
  });

  it("maps stop_reason to finish_reason", () => {
    const base = makeResult("Hi");
    assert.equal(cliResultToOpenai({ ...base, stop_reason: "end_turn" }, "r").choices[0].finish_reason, "stop");
    assert.equal(cliResultToOpenai({ ...base, stop_reason: "max_tokens" }, "r").choices[0].finish_reason, "length");
    assert.equal(cliResultToOpenai({ ...base, stop_reason: "refusal" }, "r").choices[0].finish_reason, "content_filter");
  });
});
