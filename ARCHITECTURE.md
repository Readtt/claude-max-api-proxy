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
| `src/usage/` | Token + cost-savings tracking |
| `src/types/` | Shared TypeScript types |

OpenAI function calling and `response_format` aren't native to the CLI, so they
are emulated in `adapter/tools.ts` (schemas injected into the prompt, replies
parsed back into `tool_calls`). See [COMPATIBILITY.md](COMPATIBILITY.md).

## Why stdin + a temp file

Anthropic blocks OAuth tokens from the public API, but the `claude` CLI can use
them — so the proxy drives the CLI instead of calling the API directly.

The prompt is written to the CLI's **stdin** and the system prompt to a **temp
file** passed with `--append-system-prompt-file`. Putting either on the command
line would hit the OS argument-length limit (~32 KB on Windows, `E2BIG`
elsewhere) and fail large requests — e.g. a code-review diff plus tool
definitions — before any response streamed.

The subprocess is also isolated so it behaves the same everywhere:
`--setting-sources ""` (no hooks/CLAUDE.md/plugins), `--strict-mcp-config` (no
host MCP servers), `--disable-slash-commands`, `--tools ""` (no host tool
execution), and a dedicated temp working directory. `spawn()` (not a shell) is
used, so there is no shell-injection surface.
