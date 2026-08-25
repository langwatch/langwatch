---
name: context-sweet-spot
user-prompt: "Find my context sweet spot"
description: Investigates the context economics of your own coding-agent sessions in LangWatch. Reads real sessions to find where carrying a fat context stops paying for itself, measured in cache rebuilds, compactions and cost per turn, and delivers a report with the context size your sessions should stay under, with example sessions behind every claim. Use when coding-agent sessions feel expensive or degrade as they grow.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface.
---

# Find the Context Size Where Your Sessions Stop Paying

This skill answers one question with the user's own data: at what context size do their coding-agent sessions become a bad deal? Long context is not free even when it fits the window: every cache rebuild re-bills the whole context at write rates, compactions burn turns, and models degrade before their window ends. The sweet spot is where those costs start outrunning the value of the carried context. It is read-only on the platform. Locally it writes a trace export while it works and deletes it again, and leaves one report file behind.

## Step 1: Set up the LangWatch CLI

Use the `langwatch` CLI for everything: documentation (`langwatch docs ...`, `langwatch scenario-docs ...`) and platform operations (prompts, scenarios, evaluators, datasets, monitors, traces, analytics). Install it with `npm install -g langwatch` (or run any command via `npx langwatch`).

Coding-agent sessions live in the user's personal LangWatch workspace by default. `langwatch login --device` signs this machine in; add `--project <slug>` on the read commands when the sessions live in a team project instead.

## Step 2: Collect the Sessions

Pick one window and use it everywhere, because `trace export` defaults to the last 7 days. Compute a start and an end date once (30 days back to now is a good default) and pass both:

```bash
langwatch trace export --origin coding_agent --format jsonl --limit 1000 \
  --start-date <start> --end-date <end> -o coding-traces.jsonl
```

Report the window you used in the report, and delete `coding-traces.jsonl` once the analysis is done.

Each trace carries `metadata.thread_id` (the session id) and `metadata."langwatch.source"` (which agent). Collect the distinct session ids, then for each session with enough turns to mean anything (5 or more model calls):

```bash
langwatch session events <sessionId> --format json
```

The events are the raw material: every model call with its input, output, cache-read and cache-creation tokens, its cost, its model, plus explicit `compaction` and `rate_limit` events.

## Step 3: Compute the Economics

Write a small local script (python3 or jq) over the events. Per session, compute:

1. **Peak context**: the largest (input + cache-read) of any model call, and its share of the model's context window.
2. **Cache rebuilds**: model calls whose cache-creation tokens are the bulk of their input. Each one re-paid for context that was already paid for, at the provider's cache-write rate. That rate is provider and model specific: some price a write above fresh input, some price it the same, and some charge for cache storage by time instead. Take it from the price card of the model in question, never from a rule of thumb.
3. **Compaction count and where they landed**: a compaction late in a session marks the point where the carried context stopped fitting.
4. **Cost per model call over session lifetime**: split each session into thirds by call order and compare the average cost per call between the first and last third.
5. **Waiting time around rebuilds**: rebuilt context is also re-uploaded and re-processed, so rebuild-heavy sessions are slower per turn.

Then aggregate across sessions: bucket by peak-context share (for example under 25%, 25 to 50%, 50 to 75%, over 75% of the window) and compare cost per call, rebuild rate and compaction rate between buckets. The sweet spot is the highest bucket where those three stay flat.

## Step 4: Report the Finding

Write a single self-contained `context-sweet-spot-report.html` in the project root (inline CSS, no external assets) with:

- **The number**: the context share where this user's sessions start degrading, stated in the first line ("your sessions stay economical up to about 55% of the window; past that, cost per turn doubles")
- The bucket comparison table with cost per call, rebuild rate and compaction rate per bucket
- The three most expensive sessions dissected: where the context grew, where it rebuilt, what one rebuild cost
- **Concrete habits**, each tied to the evidence: when to start a fresh session instead of pushing through, what to offload to sub-agents (their context does not ride the main session), whether the user's compactions arrive too late
- Links to example sessions in LangWatch for every claim

Also state the top finding directly in the conversation, leading with the number. The LangWatch session detail shows the same cache-health stats per session (`/me/sessions`), so name it as the place to watch the habit change.

## Common Mistakes

- Do NOT judge context by peak share alone; a fat context that never rebuilds is cheap, and a modest one that rebuilds every turn is expensive. The rebuild rate carries the finding.
- Do NOT compare sessions across different models as one population; window sizes and cache pricing differ. Bucket per model, then compare.
- Do NOT count cache-read tokens as cost the way input tokens are; they bill at a fraction. The split is in the event rows, use it.
- Do NOT report a threshold without the sessions behind it; every bucket statistic needs 2 or 3 example session ids.
- Do NOT include sessions with fewer than 5 model calls; they carry no lifetime signal and flatten the buckets.
- If the CLI returns an error, report the user-facing consequence, not the raw error text.
