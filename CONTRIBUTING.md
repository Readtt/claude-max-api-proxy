# Contributing

Thanks for helping out!

## Setup

```bash
npm install
npm run build
npm test            # builds + runs the unit tests
npm run serve       # build + start on http://localhost:3456
```

## Pull requests

1. Branch off `main`.
2. Make the change and add/adjust tests in `src/**/*.test.ts`.
3. Make sure `npm test` passes.
4. Open a PR with a clear description.

## Conventions

- TypeScript, strict mode.
- Use `spawn()` (never a shell) for subprocesses.
- Keep prompt and system-prompt content **off the command line** (stdin / temp
  file) — see [ARCHITECTURE.md](ARCHITECTURE.md).

## Bug reports

Include `node --version`, `claude --version`, your OS, repro steps, and logs.

Contributions are licensed under MIT.
