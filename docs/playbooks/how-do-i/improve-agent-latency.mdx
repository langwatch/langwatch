---
title: "How do I improve my agent's latency?"
description: "Find where your agent spends its time and give evidence-backed recommendations, branching on whether telemetry is set up correctly."
keywords: ["latency", "performance", "traces", "spans", "p95", "p50", "instrumentation", "agent"]
sidebarTitle: "Improve my agent's latency"
---

## Goal

Find where the agent spends its time. Give concrete, evidence-backed recommendations to make it faster.

You run this with the `langwatch` CLI. The CLI is already authenticated to the project.

## Prerequisites

Check each one in order. Do not report latency numbers until both pass.

1. **Telemetry arrives.**
   - Check: `langwatch trace search --limit 5 --origin application --format json`
   - The `--origin application` filter keeps Langy's own conversation traces out of the result. They are traced into the same project.
   - Search output lists traces without their spans. An empty `spans` list in search output is not a fail sign; spans are checked in prerequisite 2.
   - Pass: the command returns at least one trace from the last 7 days.
   - Repair: set up tracing first. Use the `tracing` skill, or read `langwatch docs integration/overview`. Then come back to this goal.

2. **Spans carry timing and operation attributes.**
   - Check: Take two or three trace ids from prerequisite 1 and run `langwatch trace get <trace_id> --format json` for each. Each trace must have spans with a type (`llm`, `agent`, `tool`, `chain`), a model on `llm` spans, and `finished_at` later than `started_at`. Then run `langwatch analytics query --metric p95-latency --format json` and confirm it returns a value greater than zero.
   - Fail signs: p95 of 0 ms; spans of type `span` only; no `model`; `started_at` equal to `finished_at`; no spans at all in `trace get` output.
   - Repair: use the SDK auto-instrumentation or typed spans so each operation is a span with a start time, an end time, and a type. Use the `tracing` skill or the `debug-instrumentation` skill. Then come back to this goal.

## Procedure

1. State the goal to the user: find where the agent spends its time and how to make it faster.
2. Open a task list. The first item is the goal. Add one item per prerequisite check above.
3. Run prerequisite 1 (telemetry arrives).
4. Run prerequisite 2 (spans carry timing and operation attributes).
5. If either prerequisite fails, take the matching branch below. Do not report any latency numbers. Keep the goal item open.
6. If both prerequisites pass:
   - Query aggregate latency: `langwatch analytics query --metric avg-latency --format json` and `langwatch analytics query --metric p95-latency --format json`.
   - Export traces to compute the median (p50) and to rank operations: `langwatch trace export --format jsonl --limit 1000 --origin application --include-spans -o traces.jsonl`. Compute p50 and p95 from the per-trace durations. Rank operations by span type, model, or name to find the slowest ones.
   - Pick at least one representative slow trace by id: `langwatch trace get <id>`.
   - Write recommendations tied to that evidence. Examples: reduce prompt size, stream the response, parallelise independent tool calls, cache repeated calls, switch the model for one step, cut retries or timeouts.
7. Close the goal item only when the answer meets the "What a good answer contains" list below.

## Branches

### Telemetry is not set up

Say clearly that no traces exist. Give the setup steps from prerequisite 1. Give no latency number.

### Telemetry is set up incorrectly

Name the exact missing attributes you saw (for example: durations of zero, no `model`, only `span` types). Name the repair from prerequisite 2. Give no p50 or p95 as a real figure.

### Telemetry is correct

Produce the full answer. Follow the "What a good answer contains" list below.

## What a good answer contains

- p50 and p95, with the time window they cover (the dates shown in the analytics output, or the span of the exported traces).
- The slowest operations.
- At least one trace id as evidence.
- At least one recommendation tied to that evidence.
- A note on what was checked.
