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

Pass any of these as `model`; each maps to the latest model in its family.

| `model` | Family |
|---------|--------|
| `claude-opus-4-8`, `claude-opus-4` | Opus |
| `claude-sonnet-4-6`, `claude-sonnet-4` | Sonnet |
| `claude-haiku-4-5-20251001`, `claude-haiku-4` | Haiku |

Provider prefixes also work: `anthropic/...`, `claude-max/...`, `claude-code-cli/...`.

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /v1/chat/completions` | Chat (streaming + non-streaming) |
| `GET /v1/models` | List models |
| `GET /v1/usage` | Token usage + estimated savings |
| `GET /health` | Health check |

## Optional: API key auth

For shared/team use, require a Bearer token:

```bash
API_KEYS=sk-team-abc,sk-team-def npm run serve
```

Clients then send `Authorization: Bearer sk-team-abc`. Unset = no auth.

## Notes

- Prompts go to the CLI via **stdin**, and the system prompt via a temp **file** — neither touches the command line, so large requests (e.g. code-review diffs + tool definitions) don't hit the OS argument-length limit (~32 KB on Windows / `E2BIG` elsewhere).
- See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [PROTOCOL.md](PROTOCOL.md) for the request/response mapping.

## License

MIT
