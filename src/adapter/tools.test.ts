import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildToolingSystemPrompt,
  buildResponseFormatInstruction,
  parseToolCalls,
  extractJsonContent,
} from "./tools.js";
import type { OpenAITool } from "../types/openai.js";

const weather: OpenAITool = {
  type: "function",
  function: {
    name: "get_weather",
    description: "Get weather for a city",
    parameters: {
      type: "object",
      properties: { city: { type: "string" } },
      required: ["city"],
    },
  },
};

describe("buildToolingSystemPrompt", () => {
  it("is empty with no tools and no response_format", () => {
    assert.equal(buildToolingSystemPrompt(), "");
    assert.equal(buildToolingSystemPrompt([]), "");
  });

  it("lists tools and explains the tool_calls block", () => {
    const p = buildToolingSystemPrompt([weather]);
    assert.ok(p.includes("get_weather"));
    assert.ok(p.includes("```tool_calls"));
    assert.ok(p.includes("Get weather for a city"));
  });

  it("encodes tool_choice required", () => {
    const p = buildToolingSystemPrompt([weather], "required");
    assert.ok(/MUST call at least one tool/i.test(p));
  });

  it("encodes tool_choice none", () => {
    const p = buildToolingSystemPrompt([weather], "none");
    assert.ok(/do NOT call any tool/i.test(p));
  });

  it("encodes a forced specific function", () => {
    const p = buildToolingSystemPrompt([weather], {
      type: "function",
      function: { name: "get_weather" },
    });
    assert.ok(/MUST call the function `get_weather`/.test(p));
  });

  it("appends response_format instructions", () => {
    const p = buildToolingSystemPrompt([weather], "auto", { type: "json_object" });
    assert.ok(p.includes("get_weather"));
    assert.ok(/single valid JSON value/i.test(p));
  });
});

describe("buildResponseFormatInstruction", () => {
  it("returns empty for no format or text", () => {
    assert.equal(buildResponseFormatInstruction(), "");
    assert.equal(buildResponseFormatInstruction({ type: "text" }), "");
  });

  it("handles json_object", () => {
    assert.ok(/only a single valid json/i.test(buildResponseFormatInstruction({ type: "json_object" })));
  });

  it("embeds the json_schema", () => {
    const out = buildResponseFormatInstruction({
      type: "json_schema",
      json_schema: { schema: { type: "object", properties: { x: { type: "number" } } } },
    });
    assert.ok(out.includes('"properties"'));
    assert.ok(out.includes('"x"'));
  });
});

describe("parseToolCalls", () => {
  it("returns null for plain text", () => {
    assert.equal(parseToolCalls("The weather is sunny."), null);
    assert.equal(parseToolCalls(""), null);
  });

  it("parses a fenced tool_calls block", () => {
    const text = 'Sure.\n```tool_calls\n[{"name":"get_weather","arguments":{"city":"Paris"}}]\n```';
    const calls = parseToolCalls(text);
    assert.ok(calls);
    assert.equal(calls!.length, 1);
    assert.equal(calls![0].function.name, "get_weather");
    assert.deepEqual(JSON.parse(calls![0].function.arguments), { city: "Paris" });
    assert.equal(calls![0].type, "function");
    assert.ok(calls![0].id.startsWith("call_"));
  });

  it("parses multiple calls", () => {
    const text = '```tool_calls\n[{"name":"a","arguments":{}},{"name":"b","arguments":{"n":1}}]\n```';
    const calls = parseToolCalls(text);
    assert.equal(calls!.length, 2);
    assert.equal(calls![1].function.name, "b");
  });

  it("parses a bare JSON array reply", () => {
    const calls = parseToolCalls('[{"name":"get_weather","arguments":{"city":"NYC"}}]');
    assert.ok(calls);
    assert.equal(calls![0].function.name, "get_weather");
  });

  it("accepts OpenAI-shaped {function:{name,arguments}}", () => {
    const text = '```tool_calls\n[{"function":{"name":"f","arguments":"{\\"a\\":1}"}}]\n```';
    const calls = parseToolCalls(text);
    assert.ok(calls);
    assert.equal(calls![0].function.name, "f");
    assert.deepEqual(JSON.parse(calls![0].function.arguments), { a: 1 });
  });

  it("returns null when JSON lacks a name", () => {
    assert.equal(parseToolCalls('```tool_calls\n[{"foo":"bar"}]\n```'), null);
  });
});

describe("extractJsonContent", () => {
  it("returns plain JSON unchanged (trimmed)", () => {
    assert.equal(extractJsonContent('  {"a":1}  '), '{"a":1}');
  });

  it("strips a ```json fence", () => {
    assert.equal(extractJsonContent('```json\n{"a":1}\n```'), '{"a":1}');
  });

  it("strips a bare ``` fence", () => {
    assert.equal(extractJsonContent('```\n[1,2,3]\n```'), "[1,2,3]");
  });
});
