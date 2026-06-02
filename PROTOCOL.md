# Protocol

How the proxy drives the Claude Code CLI and maps it to the OpenAI format.

## How the CLI is invoked

```bash
claude --print \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <opus|sonnet|haiku|full-id> \
  --no-session-persistence \
  --setting-sources "" --strict-mcp-config \
  --disable-slash-commands --tools "" \
  --dangerously-skip-permissions \
  --effort <level> \                       # only when reasoning_effort is set
  --system-prompt-file <tempfile>          # only when a system prompt is present
# prompt is written to stdin
```

| Flag | Why |
|------|-----|
| `--print` | Non-interactive; print and exit |
| `--output-format stream-json` | JSON-lines output (requires `--verbose`) |
| `--include-partial-messages` | Emit streaming text deltas |
| `--model` | `opus` / `sonnet` / `haiku` alias → latest in family, or a pinned full ID |
| `--effort` | Maps `reasoning_effort` (low/medium/high/xhigh/max) |
| `--system-prompt-file` | System prompt from a file, not the command line (`--append-system-prompt-file` in `append` mode) |
| isolation flags | `--setting-sources "" --strict-mcp-config --disable-slash-commands --tools ""` — behave as a pure chat API; never touch host config or run tools |

The prompt goes to **stdin** and the system prompt to a **temp file** so neither
hits the OS argument-length limit. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Output (stdout, one JSON object per line)

The proxy only cares about two message types.

**Streaming text delta** (`--include-partial-messages`) — forwarded as OpenAI
`chat.completion.chunk`s:

```json
{ "type": "stream_event",
  "event": { "type": "content_block_delta", "delta": { "type": "text_delta", "text": "Hel" } } }
```

**`result`** — the final message; the proxy reads `result` (full text) and
`usage` (token counts) from it:

```json
{
  "type": "result",
  "subtype": "success",
  "result": "The final text response",
  "stop_reason": "end_turn",
  "usage": { "input_tokens": 2, "output_tokens": 13,
             "cache_creation_input_tokens": 42255, "cache_read_input_tokens": 0 }
}
```

`stop_reason` maps to the OpenAI `finish_reason`: `end_turn`/`stop_sequence` →
`stop`, `max_tokens` → `length`, `refusal` → `content_filter`. An emulated tool
call overrides this with `tool_calls`.

Other line types (`system`/init, hooks, intermediate `assistant`) are parsed but
not needed for the OpenAI response.

## OpenAI ⇄ CLI mapping

| OpenAI request | CLI |
|----------------|-----|
| `system` / `developer` messages | concatenated → system prompt (temp file) |
| `user` messages | the prompt (stdin) |
| `assistant` messages | wrapped in `<previous_response>…</previous_response>` in the prompt |
| `model` | family alias (latest) or full ID (pinned), via `--model` |
| `tools` / `tool_choice` | injected into the system prompt; reply parsed back into `tool_calls` |
| `response_format` | system-prompt instruction to emit JSON only |
| `reasoning_effort` | `--effort <level>` |
| `image_url` content parts | sent as Anthropic image blocks via `--input-format stream-json` |
| `user` field | accepted but unused (conversations are stateless) |

Tool calling and JSON mode are emulated — see [COMPATIBILITY.md](COMPATIBILITY.md)
for the full matrix of what's supported, emulated, or ignored.

`total_cost_usd` in the CLI output reflects **subscription** usage, not API
billing — the proxy uses it only to estimate the API cost you avoided.
