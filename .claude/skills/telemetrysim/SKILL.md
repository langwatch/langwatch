---
name: telemetrysim
description: "Send seeded OTLP traces, logs and metrics at a stack with telemetrysim, haven's telemetry sender: one-off batches, sustained load at a rate, and replayable fuzz. Use when someone says 'send test traces', 'load the OTLP door', 'fuzz ingestion', 'telemetrysim', 'haven telemetry', 'fake coding-agent traffic', 'telemetry console', or needs to assert that telemetry landed."
user-invocable: true
---

# telemetrysim

Sends synthesized OTLP/HTTP (protobuf or JSON, gzip by default) at a stack's OTLP door
(`<app>/api/otel/v1/<signal>`) with the stack's seeded project key. One run at a time,
counters in memory: a dev shim, never expose it. Code: `services/telemetrysim`, console
`apps/telemetrysim-web`.

## Presets

| Preset | Signal | Shape |
|---|---|---|
| `llm-trace` (default) | traces | an agent run: two chat spans and a tool call |
| `claude-code-session` | traces | Claude Code interaction, LLM requests, tools |
| `codex-session` | traces | a Codex session |
| `logs` | logs | log records |
| `metrics` | metrics | metric points |

A batch is a pure function of preset, seed and index: the same seed sends the same ids.

## Run it

- Opt-in: `haven up +telemetry` (sticky). Hosted in the `sims` lane.
- Console: `https://telemetry.<slug>.langwatch.localhost`: the current run (verb, preset,
  seed, sent, acked, refused, failed, rate, elapsed, live while running), a start form,
  a Stop button and the last ten runs. haven gives the sim the stack's door and key, so a
  run started there needs neither.
- Standalone: `make service svc=telemetrysim` (:5599); then every run must name `endpoint`
  and `apiKey`.

## From a terminal or agent

`--json` on every verb (implied for agents); non-zero exit on failure; `--stack <slug>`
drives another worktree.

```
haven telemetry send  [--preset] [--seed] [--batches n]          # answers when done
haven telemetry load  --rate <n/s> --duration 30s [--preset]     # open loop; returns at once
haven telemetry fuzz  [--budget n] [--seed]                      # every mutation id replays
haven telemetry status | stop
```

Other flags: `--encoding protobuf|json`, `--no-gzip`, `--target <otlp base>`, `--sim <url>`.

## HTTP

```
GET    /_sim/api/status          # {stack, endpoint, presets, run, recent}
POST   /_sim/api/runs            # {mode, preset, seed, batches|rate+duration|budget[, endpoint, apiKey]}
DELETE /_sim/api/runs/current
```

The key is never echoed. `sent = acked + refused + failed`; `late` counts load ticks skipped
because 64 sends were still out; `lastError` is the newest refusal or transport error.

## Assert a run landed

1. `haven telemetry send --seed 42 --json`; expect `state: "done"`, `acked == sent`,
   `refused == 0`, `failed == 0`. A refusal reads `the door answered <status>`.
2. Then read the product, never the sim: the stack's traces, logs or metrics for the
   seeded project (the app's pages, or the `langwatch` CLI against the stack), filtered on
   the preset's `service.name` (`telemetrysim-agent` for `llm-trace`). Ingestion is
   eventually consistent: poll with a timeout rather than read once.
3. Fuzz: each `mutations[]` entry carries its id and the door's status; a 5xx is a finding,
   a 4xx is the door refusing malformed input as it should.
