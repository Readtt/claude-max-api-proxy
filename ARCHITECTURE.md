# Architecture

The proxy is a small Express server that translates OpenAI HTTP requests into
Claude Code CLI subprocess calls and translates the CLI's output back.

```
OpenAI client
   │  POST /v1/chat/completions
   ▼
Express server (src/server)
   │  openaiToCli(): messages → prompt + system prompt + model alias
   ▼
ClaudeSubprocess (src/subprocess)
   │  spawn("claude", ["--print", "--output-format","stream-json", ...])
   │  prompt        → child stdin
   │  system prompt → temp file → --append-system-prompt-file
   ▼
Claude Code CLI  →  your Claude Max subscription (OAuth, via the CLI)
   │  stream-json on stdout
   ▼
cliToOpenai(): CLI events → OpenAI chunks / response
   ▼
OpenAI client
```

## Layout

| Path | Responsibility |
|------|----------------|
| `src/server/` | Express app, routes, optional API-key auth |
| `src/adapter/` | OpenAI ⇄ CLI conversion; tool-calling + JSON-mode emulation (`tools.ts`) |
| `src/subprocess/` | Spawning and parsing the `claude` CLI |
| `src/models.ts` | Single source of truth for the model list + model resolution |
| `src/usage/` | Token + cost-savings tracking |
| `src/types/` | Shared TypeScript types |

## Models, and why the list never goes stale

`src/models.ts` is the only place that knows about models. It advertises the
three evergreen family aliases (`opus`/`sonnet`/`haiku`), which the CLI resolves
to the latest version in each family, plus any pinned IDs from
`CLAUDE_PROXY_MODELS`. Clients can also pin a full version ID per request
(`claude-opus-4-8`), passed straight through. New Claude releases therefore need
no code change. `/v1/models`, `/v1/models/{id}`, and the Clawdbot plugin all read
from this module.

## Stateless conversations

Each request spawns a fresh CLI with `--no-session-persistence`; the full
conversation is rebuilt from the request's `messages` array every time
(`adapter/openai-to-cli.ts`). There is no server-side session store, so the proxy
is safe to run as multiple instances behind a load balancer.

OpenAI function calling and `response_format` aren't native to the CLI, so they
are emulated in `adapter/tools.ts` (schemas injected into the prompt, replies
parsed back into `tool_calls`). See [COMPATIBILITY.md](COMPATIBILITY.md).

## Why stdin + a temp file

Anthropic blocks OAuth tokens from the public API, but the `claude` CLI can use
them — so the proxy drives the CLI instead of calling the API directly.

The prompt is written to the CLI's **stdin** and the system prompt to a **temp
file** passed with `--system-prompt-file` (or `--append-system-prompt-file`; see
below). Putting either on the command line would hit the OS argument-length
limit (~32 KB on Windows, `E2BIG` elsewhere) and fail large requests — e.g. a
code-review diff plus tool definitions — before any response streamed.

By default (`SYSTEM_PROMPT_MODE=replace`) the proxy **replaces** the CLI's
default system prompt, so it behaves like a neutral OpenAI-style chat model
rather than the Claude Code coding agent. Set `SYSTEM_PROMPT_MODE=append` to add
your prompt on top of the default instead. The emulated tool-calling and
JSON-mode instructions are included in the system prompt either way.

The subprocess is also isolated so it behaves the same everywhere:
`--setting-sources ""` (no hooks/CLAUDE.md/plugins), `--strict-mcp-config` (no
host MCP servers), `--disable-slash-commands`, `--tools ""` (no host tool
execution), and a dedicated temp working directory. `spawn()` (not a shell) is
used, so there is no shell-injection surface.
