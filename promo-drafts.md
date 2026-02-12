# Promotional Drafts — Ready to Post

## Reddit (r/ClaudeAI, r/LocalLLaMA, r/programming)

**Title:** I built a proxy that turns Claude Max into an OpenAI-compatible API — stop paying per-token

**Body:**
If you're paying $200/mo for Claude Max, you already have unlimited Claude access through the CLI. But what if you want to use it with Continue.dev, Cursor, custom apps, or any OpenAI client?

`claude-max-api-proxy` wraps the official Claude Code CLI and exposes it as a standard OpenAI-compatible API on localhost. No OAuth extraction, no private API reverse-engineering — just the CLI you already have, wrapped in a REST endpoint.

**What it does:**
- OpenAI-compatible `/v1/chat/completions` (streaming + non-streaming)
- Usage tracking shows exactly how much you're saving vs API pricing
- Optional API key auth for shared/team deployments
- Works with any OpenAI SDK (Python, Node, etc.)

**Quick start:**
```
npm install -g claude-max-api-proxy
claude-max-api &
curl http://localhost:3456/v1/models
```

GitHub: [link]
npm: `npm install -g claude-max-api-proxy`

---

## Twitter/X Thread

**Tweet 1:**
Paying $200/mo for Claude Max? You already have unlimited Claude access.

But only through the CLI. No API. No third-party tools.

I built a proxy that fixes that. One command, full OpenAI-compatible API on localhost.

🧵

**Tweet 2:**
How it works:
→ Spawns `claude --print` as a subprocess
→ Translates to OpenAI format
→ Exposes /v1/chat/completions
→ Streaming, usage tracking, optional auth

No OAuth hacks. No private API scraping. Just the official CLI, wrapped in REST.

**Tweet 3:**
Heavy API users spend $500-2000+/mo on Claude tokens.

Claude Max is $200/mo flat.

This proxy bridges the gap. Use your subscription with Continue, Cursor, custom apps — anything that speaks OpenAI.

npm install -g claude-max-api-proxy

**Tweet 4:**
It even tracks your savings:

GET /v1/usage → shows requests, tokens, estimated API cost saved

After a week of dev work, mine shows $400+ saved. The proxy paid for itself Day 1.

GitHub: [link]

---

## Discord (OpenClaw / AI Dev communities)

**Short version:**
Built `claude-max-api-proxy` — turns your Claude Max subscription into an OpenAI-compatible API. One npm install, runs on localhost:3456. Streaming, usage tracking, team auth. Uses the official CLI, no OAuth hacks. `npm i -g claude-max-api-proxy`

---

## Hacker News

**Title:** Show HN: Claude Max API Proxy – Use your $200/mo subscription as an OpenAI API

**Text:**
Claude Max gives you unlimited CLI access for $200/mo. But the CLI is the only way in — no API access for third-party tools.

This proxy wraps `claude --print` (the official CLI) as a standard OpenAI-compatible API server. Point any OpenAI client at localhost:3456 and use your existing subscription.

Key difference from other proxies: we don't extract OAuth tokens or reverse-engineer private APIs. We literally spawn the CLI as a subprocess. When Anthropic blocked OAuth-based harnesses in January, this approach kept working.

Features: streaming, usage/cost tracking, optional API key auth, session management.

GitHub: [link]
