---
name: analytics
description: "Analyze your AI agent's performance using LangWatch analytics. Use when the user wants to understand costs, latency, error rates, usage trends, or debug specific traces. Works with any LangWatch-instrumented agent."
---

# Analyze Agent Performance with LangWatch

This skill queries and presents analytics. It does NOT write code.

## Step 1: Set up the LangWatch CLI

Use `langwatch docs <path>` to read documentation as Markdown. Some useful entry points:

```bash
langwatch docs                                    # Docs index
langwatch docs integration/python/guide           # Python integration
langwatch docs integration/typescript/guide       # TypeScript integration
langwatch docs prompt-management/cli              # Prompts CLI
langwatch scenario-docs                           # Scenario docs index
```

Discover commands with `langwatch --help` and `langwatch <subcommand> --help`. List and get commands accept `--format json` for machine-readable output. Read the docs first instead of guessing SDK APIs or CLI flags.

If no shell is available, fetch the same Markdown over plain HTTP — append `.md` to any docs path (e.g. https://langwatch.ai/docs/integration/python/guide.md). Index: https://langwatch.ai/docs/llms.txt. Scenario index: https://langwatch.ai/scenario/llms.txt

**Authentication: already handled — do not ask.**

You are running inside the LangWatch product, already authenticated to the
user's current project. The project's API key is present in your environment as
`LANGWATCH_API_KEY` and the endpoint as `LANGWATCH_ENDPOINT`; the `langwatch`
CLI and the LangWatch tools read them automatically.

Never ask the user for an API key, never tell them to mint or paste one, and
never start a login or device-authentication flow — you are already signed in.
Every action you take already targets the right real project; there is no
personal/shared project choice to make here.

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
