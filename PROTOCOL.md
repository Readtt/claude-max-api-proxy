# Protocol

How the proxy drives the Claude Code CLI and maps it to the OpenAI format.

## How the CLI is invoked

```bash
claude --print \
  --output-format stream-json \
  --verbose \
  --include-partial-messages \
  --model <opus|sonnet|haiku> \
  --no-session-persistence \
  --dangerously-skip-permissions \
  --append-system-prompt-file <tempfile>   # only when a system prompt is present
# prompt is written to stdin
```

| Flag | Why |
|------|-----|
| `--print` | Non-interactive; print and exit |
| `--output-format stream-json` | JSON-lines output (requires `--verbose`) |
| `--include-partial-messages` | Emit streaming text deltas |
| `--model` | `opus` / `sonnet` / `haiku` alias → latest in family |
| `--append-system-prompt-file` | System prompt from a file, not the command line |

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
  "usage": { "input_tokens": 2, "output_tokens": 13,
             "cache_creation_input_tokens": 42255, "cache_read_input_tokens": 0 }
}
```

Other line types (`system`/init, hooks, intermediate `assistant`) are parsed but
not needed for the OpenAI response.

## OpenAI ⇄ CLI mapping

| OpenAI request | CLI |
|----------------|-----|
| `system` / `developer` messages | concatenated → system prompt (temp file) |
| `user` messages | the prompt (stdin) |
| `assistant` messages | wrapped in `<previous_response>…</previous_response>` in the prompt |
| `model` | mapped to an `opus`/`sonnet`/`haiku` alias |
| `user` field | session id |

`total_cost_usd` in the CLI output reflects **subscription** usage, not API
billing — the proxy uses it only to estimate the API cost you avoided.
