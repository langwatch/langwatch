---
name: debug-instrumentation
description: Debug and improve your LangWatch traces. Inspects production traces for missing input/output, disconnected spans, unlabeled traces, and missing metadata. Use when traces look broken or incomplete.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`. Works with any coding agent.
metadata:
  category: recipe
---

# Debug Your LangWatch Instrumentation

This recipe uses the `langwatch` CLI to inspect your production traces and identify instrumentation issues.

## Prerequisites

See [CLI Setup](_shared/cli-setup.md).

## Step 1: Fetch Recent Traces

```bash
langwatch trace search --limit 25 --start-date 2026-01-01 --format json
```

(Adjust `--start-date` to "last 24h" or "last 7d" — the CLI accepts ISO strings.)

For each trace, ask:
- How many traces are there?
- Do they have inputs and outputs populated, or are they `<empty>`?
- Are there labels and metadata (user_id, thread_id)?

`langwatch status` is a fast sanity check that the CLI is talking to the right project.

## Step 2: Inspect Individual Traces

```bash
langwatch trace get <traceId>            # Human-readable digest
langwatch trace get <traceId> -f json    # Full span hierarchy as JSON
```

For traces that look problematic, check for:

- **Empty input/output**: The most common issue. Check if `autotrack_openai_calls(client)` (Python) or `experimental_telemetry` (TypeScript/Vercel AI) is configured.
- **Disconnected spans**: Spans that don't connect to a parent trace. Usually means `@langwatch.trace()` decorator is missing on the entry function.
- **Missing labels**: No way to filter traces by feature/version. Add labels via `langwatch.get_current_trace().update(metadata={"labels": ["feature_name"]})`.
- **Missing user_id/thread_id**: Can't correlate traces to users or conversations. Add via trace metadata.
- **Slow spans**: Unusually long completion times may indicate API timeouts or inefficient prompts.

## Step 3: Read the Integration Docs

Use the CLI to read the integration guide for the project's framework. Compare the recommended setup with what's in the code.

```bash
langwatch docs                                  # Browse the docs index
langwatch docs integration/python/guide         # Python (or your framework)
langwatch docs integration/typescript/guide     # TypeScript (or your framework)
```

## Step 4: Apply Fixes

For each issue found:
1. Identify the root cause in the code
2. Apply the fix following the framework-specific docs
3. Run the application to generate new traces
4. Re-inspect with `langwatch trace search` and `langwatch trace get` to verify the fix

## Step 5: Verify Improvement

After fixes, compare before/after:
- Are inputs/outputs now populated?
- Are spans properly nested?
- Are labels and metadata present?

You can also export a sample for diff:
```bash
langwatch trace export --format jsonl --limit 50 -o traces.jsonl
```

## Common Issues and Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| All traces show `<empty>` input/output | Missing autotrack or telemetry config | Add `autotrack_openai_calls(client)` or `experimental_telemetry: { isEnabled: true }` |
| Spans not connected to traces | Missing `@langwatch.trace()` on entry function | Add trace decorator to the main function |
| No labels on traces | Labels not set in trace metadata | Add `metadata={"labels": ["feature"]}` to trace update |
| Missing user_id | User ID not passed to trace | Add `user_id` to trace metadata |
| Traces from different calls merged | Missing `langwatch.setup()` or trace context not propagated | Ensure `langwatch.setup()` called at startup |
