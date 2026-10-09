---
name: telemetrysim
description: "Send seeded OTLP traces, logs and metrics at a stack with telemetrysim, haven's telemetry sender: one-off batches, sustained load at a rate, replayable fuzz, and single requests that show the door's answer (415, 429 with Retry-After, 503). Use when someone says 'send test traces', 'load the OTLP door', 'fuzz ingestion', 'what does the OTLP door answer', 'post one OTLP request', 'telemetrysim', 'haven telemetry', 'fake coding-agent traffic', 'telemetry console', 'OTLP fixtures', or needs to assert that telemetry landed."
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
- Console: `https://telemetry.<slug>.langwatch.localhost` (`haven telemetry console` prints
  it). haven gives the sim the stack's door and key, so nothing there needs a key. Tabs:
  - **Runs**: a start form, the current run and the last ten; a run opens with its rate,
    `sent = acked + refused + failed`, answers by status (every attempt, retries included),
    Retry-After count and last value, p50/p90/p99/max latency, and fuzz mutations
    (5xx and no-answer findings first). Stop sits in the header.
  - **Send one**: one request (a preset, or pasted OTLP JSON) as protobuf or JSON, gzip or
    not, no retry, no run; shows the URL, status, Retry-After, latency and the door's body.
  - **Fixtures**: every preset (its body from any seed) and every recording under
    `services/telemetrysim/fixtures/<family>/<name>.otlp.json`; each sends with one click.
  - **Setup**: the OTLP base, the key's ends and source (`TELEMETRYSIM_API_KEY`, never the
    key), the project (`local-dev-org/local-dev-project`), and the terminal verbs.
- Standalone: `make service svc=telemetrysim` (:5599); then every run must name `endpoint`
  and `apiKey`.

## From a terminal or agent

`--json` on every verb (implied for agents); non-zero exit on failure; `--stack <slug>`
drives another worktree.

```
haven telemetry send  [--preset] [--seed] [--batches n]          # answers when done
haven telemetry load  --rate <n/s> --duration 30s [--preset]     # open loop; returns at once
haven telemetry fuzz  [--budget n] [--seed]                      # every mutation id replays
haven telemetry post  [--preset | --fixture <family/name> | --body-file <otlp.json>]
                                                                 # one request, the door's answer
haven telemetry runs | run <id|current>                          # list; one with answers, latency, mutations
haven telemetry fixtures | fixture <name> [--seed]               # list; one body as OTLP JSON
haven telemetry status | stop | console                          # console prints the URL
```

Other flags: `--encoding protobuf|json`, `--no-gzip`, `--target <otlp base>`, `--sim <url>`.
`post` exits zero whatever the door says: a refusal is an answer; read `status`.

## HTTP

```
GET    /_sim/api/status          # {stack, endpoint, keySource, keyHint, project, presets, run, recent}
POST   /_sim/api/runs            # {mode, preset, seed, batches|rate+duration|budget[, endpoint, apiKey]}
GET    /_sim/api/runs            # {runs}: current first, without mutations
GET    /_sim/api/runs/{id}       # one run with mutations; id "current" is the newest
DELETE /_sim/api/runs/current
POST   /_sim/api/send-one        # {preset|fixture|body, seed, encoding, noGzip[, endpoint, apiKey]}
                                 #  -> {url, signal, encoding, gzip, bytes, status, retryAfter,
                                 #      contentType, body, latencyMs, error}; 400 only if unbuildable
GET    /_sim/api/fixtures        # {fixtures: [{name, kind: preset|recorded, signal, ...}]}
GET    /_sim/api/fixtures/{name} # {..., body}: a preset from ?seed (default 1), a recording as committed
```

The key is never echoed. A run's `answers` maps status to attempts (retries included; no
answer counts in `failed`), `retryAfterSeen`/`lastRetryAfter` count the Retry-After headers,
and `latency` holds nearest-rank percentiles over the newest 4096 attempts. Retries do not
yet wait for Retry-After; they back off 50 then 100 ms. `sent = acked + refused + failed`; `late` counts load ticks skipped
because 64 sends were still out; `lastError` is the newest refusal or transport error.

## Assert a run landed

1. `haven telemetry send --seed 42 --json`; expect `state: "done"`, `acked == sent`,
   `refused == 0`, `failed == 0`. A refusal reads `the door answered <status>`.
2. Then read the product, never the sim: the stack's traces, logs or metrics for the
   seeded project (the app's pages, or the `langwatch` CLI against the stack), filtered on
   the preset's `service.name` (`telemetrysim-agent` for `llm-trace`). Ingestion is
   eventually consistent: poll with a timeout rather than read once.
3. Fuzz: each `mutations[]` entry carries its id and the door's status; a 5xx is a finding,
   a 4xx is the door refusing malformed input as it should. `haven telemetry run current --json`
   gives them all.
4. One answer: `haven telemetry post --encoding json --json` and assert on `status` (and
   `retryAfter` for a 429/503). To see the door refuse on purpose, post a broken export as
   JSON (`--body-file broken.json --encoding json`); the sim only refuses a body with no
   `resourceSpans`, `resourceLogs` or `resourceMetrics`.
