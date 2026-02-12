import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractModel, messagesToPrompt, openaiToCli } from "./openai-to-cli.js";

describe("extractModel", () => {
  it("maps direct model names", () => {
    assert.equal(extractModel("claude-opus-4"), "opus");
    assert.equal(extractModel("claude-opus-4-6"), "opus");
    assert.equal(extractModel("claude-sonnet-4"), "sonnet");
    assert.equal(extractModel("claude-haiku-4"), "haiku");
  });

  it("maps provider-prefixed names", () => {
    assert.equal(extractModel("claude-code-cli/claude-opus-4"), "opus");
    assert.equal(extractModel("anthropic/claude-opus-4-6"), "opus");
    assert.equal(extractModel("claude-max/claude-sonnet-4"), "sonnet");
  });

  it("maps aliases", () => {
    assert.equal(extractModel("opus"), "opus");
    assert.equal(extractModel("sonnet"), "sonnet");
    assert.equal(extractModel("haiku"), "haiku");
  });

  it("defaults to opus for unknown models", () => {
    assert.equal(extractModel("gpt-4o"), "opus");
    assert.equal(extractModel("unknown-model"), "opus");
  });
});

describe("messagesToPrompt", () => {
  it("converts a single user message", () => {
    const result = messagesToPrompt([
      { role: "user", content: "Hello" },
    ]);
    assert.equal(result, "Hello");
  });

  it("wraps system messages in tags", () => {
    const result = messagesToPrompt([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Hi" },
    ]);
    assert.ok(result.includes("<system>"));
    assert.ok(result.includes("You are helpful"));
    assert.ok(result.includes("</system>"));
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
});

describe("openaiToCli", () => {
  it("returns prompt and model", () => {
    const result = openaiToCli({
      model: "claude-opus-4-6",
      messages: [{ role: "user", content: "Test" }],
    });
    assert.equal(result.model, "opus");
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
});
