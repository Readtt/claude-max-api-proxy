# Claude Max API Proxy

Use your **Claude Max** subscription as an **OpenAI-compatible API**. Any OpenAI client (Continue.dev, Cursor, OpenClaw, the OpenAI SDKs, `curl`) talks to this proxy on `localhost`, and the proxy runs your prompts through the Claude Code CLI you're already paying for — no per-token API bill.

> Subject to Anthropic's [fair use policy](https://www.anthropic.com/terms). This wraps the official `claude` CLI; it does not extract tokens or bypass auth.

## Requirements

- A **Claude Max** subscription
- **Node.js 20+**
- **Claude Code CLI**, installed and logged in:
  ```bash
  npm install -g @anthropic-ai/claude-code
  claude          # log in once, interactively
  ```

## Run it

```bash
git clone https://github.com/Readtt/claude-max-api-proxy.git
cd claude-max-api-proxy
npm install
npm run serve     # builds, then starts on http://localhost:3456
```

That's it. Quick check:

```bash
curl http://localhost:3456/v1/models
```

To use a different port: `node dist/server/standalone.js 8080`.

## Use it

Point any OpenAI client at `http://localhost:3456/v1`.

```bash
curl -X POST http://localhost:3456/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-opus-4-8","messages":[{"role":"user","content":"Hello!"}]}'
```

Add `"stream": true` for SSE token streaming.

**Python (OpenAI SDK):**

```python
from openai import OpenAI
client = OpenAI(base_url="http://localhost:3456/v1", api_key="not-needed")
client.chat.completions.create(
    model="claude-opus-4-8",
    messages=[{"role": "user", "content": "Hello!"}],
)
```

**Continue.dev / Cursor:** add a model with `provider: openai`, `apiBase: http://localhost:3456/v1`, any `apiKey`.

## Models

Two ways to choose a model, so you never have to update the proxy for new
releases:

- **Latest in a family** — use a bare alias: `opus`, `sonnet`, or `haiku`
  (also matched in any name, e.g. `claude-opus-4` → latest Opus).
- **Pin a specific version** — use the full ID and it's passed straight to the
  CLI: `claude-opus-4-7`, `claude-sonnet-4-5-20250929`, etc. Availability
  depends on your subscription.

Provider prefixes are fine too: `anthropic/...`, `claude-max/...`,
`claude-code-cli/...`. Unknown names default to the latest Opus.

`GET /v1/models` lists the three family aliases (always the latest), so it never
goes stale. To also advertise specific pinned IDs (e.g. for a UI model picker),
set `CLAUDE_PROXY_MODELS=claude-opus-4-8,claude-sonnet-4-6`.

## OpenAI compatibility

Use it as a drop-in OpenAI endpoint: chat, streaming, **function/tool calling**,
**JSON mode** (`response_format`), **image input/vision** (`image_url`), and
**`reasoning_effort`** all work. Sampling params like `temperature` and
`max_tokens` are accepted but ignored (the CLI can't honor them), and
embeddings/image-generation/audio aren't available. Full matrix:
[COMPATIBILITY.md](COMPATIBILITY.md).

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | Chat (streaming + non-streaming) |
| `GET /v1/models` | List models |
| `GET /v1/models/{id}` | Retrieve a single model |
| `GET /v1/usage`, `GET /v1/usage/recent` | Token usage + estimated savings |
| `GET /health` | Health check |

## Optional: API key auth

For shared/team use, require a Bearer token:

```bash
API_KEYS=sk-team-abc,sk-team-def npm run serve
```

Clients then send `Authorization: Bearer sk-team-abc`. Unset = no auth.

## Configuration

All optional, set as environment variables:

| Variable | Default | Purpose |
|----------|---------|---------|
| `API_KEYS` | _(unset)_ | Comma-separated Bearer tokens to require (see above). |
| `CLAUDE_PROXY_MODELS` | _(unset)_ | Extra pinned model IDs to list in `/v1/models`. |
| `SYSTEM_PROMPT_MODE` | `replace` | `replace` = your system prompt fully defines the persona (neutral, OpenAI-like). `append` = add it on top of Claude Code's default prompt. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, or `debug`. `info` logs each request/response (model, duration, tokens); `debug` adds per-chunk subprocess detail. |
| `DEBUG` | _(unset)_ | Legacy alias — any value forces `LOG_LEVEL=debug`. |

## Notes

- Prompts go to the CLI via **stdin**, and the system prompt via a temp **file** — neither touches the command line, so large requests (e.g. code-review diffs + tool definitions) don't hit the OS argument-length limit (~32 KB on Windows / `E2BIG` elsewhere).
- See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [PROTOCOL.md](PROTOCOL.md) for the request/response mapping.

## License

MIT
