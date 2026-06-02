import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  resolveModelArg,
  familyOf,
  stripProviderPrefix,
  listModels,
  getModel,
  isKnownModelId,
  MODEL_FAMILIES,
  DEFAULT_MODEL_ALIAS,
} from "./models.js";

afterEach(() => {
  delete process.env.CLAUDE_PROXY_MODELS;
});

describe("resolveModelArg", () => {
  it("maps aliases and major-only names to the family", () => {
    assert.equal(resolveModelArg("opus"), "opus");
    assert.equal(resolveModelArg("SONNET"), "sonnet");
    assert.equal(resolveModelArg("claude-haiku-4"), "haiku");
  });

  it("pins full version IDs verbatim", () => {
    assert.equal(resolveModelArg("claude-opus-4-8"), "claude-opus-4-8");
    assert.equal(resolveModelArg("claude-sonnet-4-5-20250929"), "claude-sonnet-4-5-20250929");
  });

  it("strips provider prefixes and defaults unknowns to opus", () => {
    assert.equal(resolveModelArg("anthropic/claude-opus-4-7"), "claude-opus-4-7");
    assert.equal(resolveModelArg("gpt-4o"), "opus");
    assert.equal(resolveModelArg(""), "opus");
  });
});

describe("familyOf / stripProviderPrefix", () => {
  it("detects families across prefixes", () => {
    assert.equal(familyOf("claude-max/claude-haiku-4-5"), "haiku");
    assert.equal(familyOf("sonnet"), "sonnet");
    assert.equal(familyOf("anything-else"), "opus");
  });

  it("strips known prefixes only", () => {
    assert.equal(stripProviderPrefix("claude-code-cli/opus"), "opus");
    assert.equal(stripProviderPrefix("opus"), "opus");
  });
});

describe("listModels", () => {
  it("lists the three evergreen family aliases by default", () => {
    const ids = listModels().map((m) => m.id);
    assert.deepEqual(ids, [...MODEL_FAMILIES]);
  });

  it("appends pinned IDs from CLAUDE_PROXY_MODELS (deduped)", () => {
    process.env.CLAUDE_PROXY_MODELS = "claude-opus-4-8, claude-sonnet-4-6, opus";
    const ids = listModels().map((m) => m.id);
    assert.deepEqual(ids, ["opus", "sonnet", "haiku", "claude-opus-4-8", "claude-sonnet-4-6"]);
    // family is derived for the extras
    assert.equal(listModels().find((m) => m.id === "claude-sonnet-4-6")!.family, "sonnet");
  });
});

describe("getModel / isKnownModelId", () => {
  it("resolves aliases and recognizable Claude IDs", () => {
    assert.equal(getModel("opus")!.id, "opus");
    assert.equal(getModel("claude-opus-4-8")!.family, "opus");
    assert.ok(isKnownModelId("claude-sonnet-4-6"));
    assert.ok(isKnownModelId("haiku"));
  });

  it("returns undefined for foreign names", () => {
    assert.equal(getModel("gpt-4o"), undefined);
    assert.equal(isKnownModelId("gpt-4o"), false);
  });
});

describe("DEFAULT_MODEL_ALIAS", () => {
  it("is a valid family alias", () => {
    assert.ok((MODEL_FAMILIES as readonly string[]).includes(DEFAULT_MODEL_ALIAS));
  });
});
