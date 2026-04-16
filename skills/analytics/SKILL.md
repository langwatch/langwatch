---
name: analytics
user-prompt: "How is my agent performing?"
description: Analyze your AI agent's performance using LangWatch analytics. Use when the user wants to understand costs, latency, error rates, usage trends, or debug specific traces. Works with any LangWatch-instrumented agent.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface.
---

# Analyze Agent Performance with LangWatch

This skill queries and presents analytics. It does NOT write code.

## Step 1: Set up the LangWatch CLI

See [CLI Setup](_shared/cli-setup.md).

## Step 2: Get a Project Overview

```bash
langwatch status
```

This shows resource counts (traces, evaluators, scenarios, datasets, etc.) and reminds you which subcommands are available.

## Step 3: Query Trends and Aggregations

Use `langwatch analytics query` for time-series data and aggregate metrics. Start with the presets:

```bash
langwatch analytics query --metric trace-count        # Total traces over the last 7 days
langwatch analytics query --metric total-cost         # Total LLM cost
langwatch analytics query --metric avg-latency        # Average completion latency
langwatch analytics query --metric p95-latency        # P95 completion latency
langwatch analytics query --metric eval-pass-rate     # Evaluation pass rate
```

Refine with `--start-date`, `--end-date`, `--group-by`, `--time-scale`, and `--aggregation`. Use `langwatch analytics query --help` to see every flag and `--format json` to feed the output to other tools.

If you don't know which preset names exist or want a non-preset metric path:

```bash
langwatch analytics query --help                       # Lists presets and flags
langwatch docs analytics/custom-metrics                # Background on the metric model
```

## Step 4: Find Specific Traces

```bash
langwatch trace search -q "error" --limit 10           # Find error traces by keyword
langwatch trace search --start-date 2026-01-01         # Custom date range
langwatch trace search --format json                   # Machine-readable output
```

## Step 5: Inspect Individual Traces

```bash
langwatch trace get <traceId>                          # Human-readable digest (default)
langwatch trace get <traceId> -f json                  # Raw JSON for full detail
langwatch trace export --format csv -o traces.csv      # Bulk export as CSV
langwatch trace export --format jsonl --limit 500      # Bulk export as JSONL
```

For each interesting trace, look at:
- The full request/response
- Token counts and costs per span
- Error messages and stack traces
- Individual LLM calls within a multi-step agent

## Step 6: Present Findings

Summarize the data clearly for the user:

- Lead with the key numbers they asked about
- Highlight anomalies or concerning trends (cost spikes, latency increases, error rate changes)
- Provide context by comparing to previous periods when relevant
- Suggest next steps if issues are found (e.g., "The p95 latency spiked on Tuesday — here are the slowest traces from that day")

## Common Mistakes

- Do NOT try to write code — this skill queries existing data, no SDK installation or code changes
- Use the preset names with `langwatch analytics query --metric ...` (trace-count, total-cost, avg-latency, etc.); do NOT hardcode raw metric paths unless the preset list doesn't cover what you need
- Do NOT use `langwatch evaluator create` / `langwatch monitor create` here — this skill is read-only analytics
- Do NOT present raw JSON to the user — summarize the data in a clear, human-readable format
- If the CLI returns an error, surface the exact message in your reply rather than paraphrasing — the user often needs the raw error to debug API key, project, or date-range issues
