# telemetrysim fixtures: scrubbed recordings

This directory holds **recorded** OTLP exports of real agents and SDKs, scrubbed,
beside telemetrysim's synthesized presets (`payload.go`). It is empty until the
first recording lands. Never commit a synthesized payload here and call it recorded.

## Layout

```
fixtures/<family>/<name>.otlp.json   # one OTLP/JSON export request per file, in send order
fixtures/<family>/<name>.expected.json  # what ingestion must read back: sessions, turns, tokens, cost
```

`<family>` is one of `claude-code`, `codex`, `gemini`, `opencode`, `copilot`, `sdk-python`,
`sdk-typescript`, `sdk-go`.

## Capturing one

1. Isolate the agent's config first (`dev/docs/best_practices/dogfooding-isolation.md`).
2. Point its OTLP exporter at a local collector with a file exporter (JSON), run one short session.
3. Scrub: replace every user, path, hostname, email, prompt and completion text with neutral
   text; drop api keys and tokens; keep names, counts, token and cost attributes.
4. Write `expected.json` from the scrubbed export, then commit both.

## How telemetrysim will use them

A loader (not built yet) re-mints trace, span and session ids and shifts every instant to the
run's start from the run's seed, so a recording replays as many independent sessions.
