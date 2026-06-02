# OpenAI compatibility

This proxy speaks the OpenAI **Chat Completions** API. Because it runs on top
of the Claude Code CLI (not the raw Anthropic API), some things work natively,
some are emulated, and a few can't be supported. This page is the honest map.

**TL;DR** — for normal chat, streaming, tool/function calling, JSON output, and
image input (vision), you can use it as a drop-in replacement for an OpenAI key.
Sampling knobs (temperature, max_tokens, …) are accepted but ignored, and
embeddings / image generation / the legacy completions endpoint aren't
available.

## Endpoints

| Endpoint | Status |
|----------|--------|
| `POST /v1/chat/completions` | ✅ Supported (streaming + non-streaming) |
| `GET /v1/models` | ✅ Supported |
| `GET /v1/usage`, `/v1/usage/recent` | ✅ Extra (token usage + estimated savings) |
| `GET /health` | ✅ Extra |
| `POST /v1/completions` (legacy) | ❌ Not supported — use chat completions |
| `POST /v1/embeddings` | ❌ Not supported — CLI has no embeddings |
| `/v1/audio/*`, `/v1/images/*` | ❌ Not supported |

## `chat/completions` request fields

| Field | Status | Notes |
|-------|--------|-------|
| `model` | ✅ | Family alias (`opus`/`sonnet`/`haiku`) → latest; full ID (`claude-opus-4-7`) pins that version. See [README](README.md#models). |
| `messages` | ✅ | `system`, `developer`, `user`, `assistant`, `tool`/`function` roles all handled. |
| `stream` | ✅ | SSE token streaming. |
| `tools`, `tool_choice` | ✅ *Emulated* | OpenAI function calling. See below. |
| `response_format` | ✅ *Emulated* | `json_object` and `json_schema`. See below. |
| `user` | ✅ | Used as a session hint. |
| `temperature`, `top_p` | ⚠️ Ignored | The CLI exposes no sampling controls. Accepted so clients don't break. |
| `max_tokens`, `max_completion_tokens` | ⚠️ Ignored | No CLI flag to cap output length. |
| `stop` | ⚠️ Ignored | No CLI stop-sequence support. |
| `seed` | ⚠️ Ignored | No deterministic seeding. |
| `n` | ⚠️ Ignored | Always one choice. |
| `frequency_penalty`, `presence_penalty` | ⚠️ Ignored | Not exposed by the CLI. |
| `logprobs`, `top_logprobs` | ❌ | Not available. |
| image (`image_url`) content parts | ✅ | Vision. `data:` (base64) and http(s) URLs. See below. |

> ⚠️ "Ignored" means the field is accepted and the request still succeeds — the
> value just has no effect. Nothing 400s on an unknown or unsupported param.

## `chat/completions` response fields

| Field | Status |
|-------|--------|
| `choices[].message.content` | ✅ |
| `choices[].message.tool_calls` | ✅ (emulated) |
| `choices[].finish_reason` | ✅ `stop` / `tool_calls` |
| `usage` (prompt/completion/total tokens) | ✅ Real counts from the CLI |
| streaming chunks (`chat.completion.chunk`) | ✅ content + tool_calls deltas |

## Function / tool calling (emulated)

Send `tools` and (optionally) `tool_choice` exactly as you would with OpenAI:

```json
{
  "model": "opus",
  "messages": [{ "role": "user", "content": "Weather in Paris?" }],
  "tools": [{
    "type": "function",
    "function": {
      "name": "get_weather",
      "description": "Get current weather for a city",
      "parameters": {
        "type": "object",
        "properties": { "city": { "type": "string" } },
        "required": ["city"]
      }
    }
  }]
}
```

You get back a standard tool call:

```json
{
  "choices": [{
    "message": {
      "role": "assistant",
      "content": null,
      "tool_calls": [{
        "id": "call_…",
        "type": "function",
        "function": { "name": "get_weather", "arguments": "{\"city\":\"Paris\"}" }
      }]
    },
    "finish_reason": "tool_calls"
  }]
}
```

Then continue the conversation by appending the assistant message and a
`role: "tool"` result (with `tool_call_id`), same as OpenAI. `tool_choice`
supports `"auto"`, `"none"`, `"required"`, and `{ "type": "function",
"function": { "name": "…" } }`.

**How it works:** the tool schemas are injected into the system prompt and the
model is asked to reply in a fenced `tool_calls` block, which the proxy parses
back into `tool_calls`. This is emulation, so it's reliable with Claude but not
byte-for-byte guaranteed — argument JSON occasionally needs a nudge in the
function description. It is not the native Anthropic tool-use API.

## JSON output (emulated)

Both forms work and return parseable JSON as the message content:

```json
{ "response_format": { "type": "json_object" } }
{ "response_format": { "type": "json_schema",
  "json_schema": { "schema": { "type": "object", "properties": { "name": {"type":"string"} } } } } }
```

The proxy instructs the model to emit JSON only and strips any stray code fence.
The schema guides the model but isn't hard-validated by the proxy.

## Image input (vision)

Send images with the standard OpenAI content-parts format. Both base64 `data:`
URLs and remote http(s) URLs work:

```json
{
  "model": "opus",
  "messages": [{
    "role": "user",
    "content": [
      { "type": "text", "text": "What's in this image?" },
      { "type": "image_url", "image_url": { "url": "data:image/png;base64,iVBORw0K..." } }
    ]
  }]
}
```

When any message contains an image, the proxy switches the CLI to stream-json
input and forwards the images as Anthropic image blocks. Works in streaming and
non-streaming mode. (Image *generation* — creating images — is not supported;
this is vision input only.)

## When tools or JSON mode are on, streaming buffers

A tool call is JSON that has to become `tool_calls` (not streamed text), so with
`tools` or `response_format` set the proxy waits for the full reply, then emits
it — one `tool_calls` delta, or one content delta of clean JSON. Plain chat
streams token-by-token as usual.

## What you can't replicate from a real OpenAI/Anthropic key

- Sampling control (temperature, top_p, max_tokens, stop, seed).
- Token-probability data (logprobs).
- Embeddings, image *generation*, audio. (Image *input*/vision works.)
- Guaranteed-schema structured outputs (it's prompt-guided, not enforced).

Everything else in day-to-day chat + tool-using app development works.
