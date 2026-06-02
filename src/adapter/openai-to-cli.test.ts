import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractModel, messagesToPrompt, extractSystemPrompt, openaiToCli } from "./openai-to-cli.js";

describe("extractModel", () => {
  it("maps bare aliases to the family (latest)", () => {
    assert.equal(extractModel("opus"), "opus");
    assert.equal(extractModel("sonnet"), "sonnet");
    assert.equal(extractModel("haiku"), "haiku");
    assert.equal(extractModel("OPUS"), "opus"); // case-insensitive
  });

  it("maps major-only names to the family alias (not a valid full ID)", () => {
    assert.equal(extractModel("claude-opus-4"), "opus");
    assert.equal(extractModel("claude-sonnet-4"), "sonnet");
    assert.equal(extractModel("claude-haiku-4"), "haiku");
  });

  it("pins specific versions by passing the full ID through", () => {
    assert.equal(extractModel("claude-opus-4-7"), "claude-opus-4-7");
    assert.equal(extractModel("claude-opus-4-8"), "claude-opus-4-8");
    assert.equal(extractModel("claude-sonnet-4-6"), "claude-sonnet-4-6");
    assert.equal(
      extractModel("claude-haiku-4-5-20251001"),
      "claude-haiku-4-5-20251001"
    );
  });

  it("strips provider prefixes before resolving", () => {
    assert.equal(extractModel("anthropic/claude-opus-4-7"), "claude-opus-4-7");
    assert.equal(extractModel("claude-max/claude-sonnet-4-6"), "claude-sonnet-4-6");
    assert.equal(extractModel("claude-code-cli/opus"), "opus");
    assert.equal(extractModel("claude-max/claude-opus-4"), "opus"); // major-only -> alias
  });

  it("future-proofs new versions without code changes", () => {
    assert.equal(extractModel("claude-opus-5-0"), "claude-opus-5-0"); // pinned
    assert.equal(extractModel("claude-opus-5"), "opus"); // major-only -> latest opus
    assert.equal(extractModel("anthropic/claude-sonnet-5-1"), "claude-sonnet-5-1");
  });

  it("defaults to opus for unknown or empty models", () => {
    assert.equal(extractModel("gpt-4o"), "opus");
    assert.equal(extractModel("unknown-model"), "opus");
    assert.equal(extractModel(""), "opus");
  });
});

describe("messagesToPrompt", () => {
  it("converts a single user message", () => {
    const result = messagesToPrompt([
      { role: "user", content: "Hello" },
    ]);
    assert.equal(result, "Hello");
  });

  it("excludes system messages from prompt (handled via --append-system-prompt)", () => {
    const result = messagesToPrompt([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ]);
    assert.ok(!result.includes("You are helpful"));
    assert.ok(result.includes("Hi"));
  });

  it("wraps assistant messages in previous_response tags", () => {
    const result = messagesToPrompt([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
    assert.ok(result.includes("<previous_response>"));
    assert.ok(result.includes("Hello!"));
    assert.ok(result.includes("How are you?"));
  });

  it("handles array content parts", () => {
    const result = messagesToPrompt([
      {
        role: "user",
        content: [
          { type: "text", text: "First" },
          { type: "text", text: "Second" },
        ],
      },
    ]);
    assert.ok(result.includes("First"));
    assert.ok(result.includes("Second"));
  });

  it("renders assistant tool_calls into the prompt", () => {
    const result = messagesToPrompt([
      { role: "user", content: "weather in Paris?" },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "get_weather", arguments: '{"city":"Paris"}' },
          },
        ],
      },
    ]);
    assert.ok(result.includes("```tool_calls"));
    assert.ok(result.includes("get_weather"));
    assert.ok(result.includes("Paris"));
  });

  it("renders tool result messages", () => {
    const result = messagesToPrompt([
      { role: "user", content: "weather?" },
      {
        role: "tool",
        tool_call_id: "call_1",
        name: "get_weather",
        content: "Sunny, 21C",
      },
    ]);
    assert.ok(result.includes("<tool_result"));
    assert.ok(result.includes('tool_call_id="call_1"'));
    assert.ok(result.includes("Sunny, 21C"));
  });
});

describe("extractSystemPrompt", () => {
  it("extracts system messages", () => {
    const result = extractSystemPrompt([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ]);
    assert.equal(result, "You are helpful");
  });

  it("concatenates multiple system messages", () => {
    const result = extractSystemPrompt([
      { role: "system", content: "Be helpful" },
      { role: "system", content: "Be concise" },
      { role: "user", content: "Hi" },
    ]);
    assert.equal(result, "Be helpful\nBe concise");
  });

  it("returns undefined when no system messages", () => {
    const result = extractSystemPrompt([
      { role: "user", content: "Hi" },
    ]);
    assert.equal(result, undefined);
  });

  it("handles developer role as system", () => {
    const result = extractSystemPrompt([
      { role: "developer", content: "You are an assistant" },
      { role: "user", content: "Hi" },
    ]);
    assert.equal(result, "You are an assistant");
  });
});

describe("openaiToCli", () => {
  it("returns prompt and model", () => {
    const result = openaiToCli({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "Test" }],
    });
    assert.equal(result.model, "claude-opus-4-6"); // specific version is pinned
    assert.equal(result.prompt, "Test");
  });

  it("uses user field as sessionId", () => {
    const result = openaiToCli({
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "Test" }],
      user: "session-123",
    });
    assert.equal(result.sessionId, "session-123");
  });

  it("extracts system prompt separately", () => {
    const result = openaiToCli({
      model: "claude-opus-4-6",
      messages: [
        { role: "system", content: "Be concise" },
        { role: "user", content: "Hello" },
      ],
    });
    assert.equal(result.systemPrompt, "Be concise");
    assert.equal(result.prompt, "Hello");
  });
});
