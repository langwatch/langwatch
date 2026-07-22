---
name: agent-performance
user-prompt: "How is my agent performing?"
description: Deep-dive diagnosis of how your AI agent behaves in production. Explores LangWatch analytics and traces end to end to map failure patterns, dissatisfied users, token cost hotspots, edge cases, behavior changes, and outliers, then delivers an HTML report where every finding links to real example traces. Use when you want to truly understand what your agent is doing in production.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface.
---

# Diagnose Your Agent's Production Behavior

This skill is a production diagnostician. It reads the real traffic, not the code, and answers: what is my agent actually doing out there, where is it failing, who is it annoying, and where is the money going. It is read-only on the platform: the only thing it writes is a report file.

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

If no shell is available, fetch the same Markdown over plain HTTP. Append `.md` to any docs path (e.g. https://langwatch.ai/docs/integration/python/guide.md). Index: https://langwatch.ai/docs/llms.txt. Scenario index: https://langwatch.ai/scenario/llms.txt

**Projects and API keys: target a real project, not a personal one.**

LangWatch has two kinds of project:

- **Team / shared projects**: real projects inside an organization. Evaluations, experiments, prompts, datasets, simulations and instrumentation must always target one of these.
- **Personal projects**: a private "My Workspace" scratch space tied to a single user. Never send a user's evaluations, experiments or production traces here: it is for personal exploration only and is easily confused with a real project.

And two ways to authenticate:

- **A project API key in `.env`** (`LANGWATCH_API_KEY`): the credential everything in these skills uses. It is scoped to one real project. This is the default; prefer it unless the user explicitly asks for something else.
- **`langwatch login --device` (AI-tools / SSO)**: a personal device session for wrapping coding assistants (`langwatch claude`, `langwatch codex`, …). It is NOT for evaluations, prompts, datasets, scenarios or SDK instrumentation, and it points at a personal workspace. Do not run it to set up the work in these skills.

So for anything in these skills: make sure `LANGWATCH_API_KEY` for a real, shared project is in the project's `.env` — most environments already have this provisioned. Do NOT run `langwatch login` to pick a project, and never default to a personal project. If `LANGWATCH_ENDPOINT` is set, they are self-hosted, use that endpoint instead of app.langwatch.ai.

## Step 2: Baseline the Vital Signs

Establish the macro picture first, always comparing against the previous period (the analytics API returns both periods for every query):

```bash
langwatch status                                                  # Resource counts and project overview
langwatch analytics query --metric trace-count --format json      # Volume trend, last 7 days
langwatch analytics query --metric total-cost --format json       # Spend trend
langwatch analytics query --metric avg-latency --format json      # Latency trend
langwatch analytics query --metric p95-latency --format json      # Tail latency
langwatch analytics query --metric total-tokens --format json     # Token consumption
langwatch analytics query --metric eval-pass-rate --format json   # Quality trend, if evaluators exist
```

Then slice the same metrics to find WHERE the numbers come from:

```bash
langwatch analytics query --metric total-cost --group-by metadata.model --format json
langwatch analytics query --metric trace-count --group-by metadata.labels --format json
langwatch analytics query --metric p95-latency --group-by metadata.model --format json
```

Widen with `--start-date` (ISO) to 30 days when trends look suspicious: a gradual drift only shows on longer windows. Run `langwatch analytics query --help` for every preset and flag.

## Step 3: Export the Evidence and Mine It

Aggregates say WHAT changed; only the traces say WHY. Export a large sample and analyze it locally:

```bash
langwatch trace export --format jsonl --limit 1000 -o traces.jsonl
langwatch trace export --format jsonl --limit 1000 --start-date <30d-ago> --end-date <14d-ago> -o traces-before.jsonl
```

Write small local scripts (python3 or jq) over the JSONL to compute, at minimum:

1. **Failure patterns**: cluster error traces by error message and by input shape. Which user intents fail most?
2. **Dissatisfied users**: traces with negative feedback or angry language in inputs ("this is wrong", "that's not what I asked", repeated rephrasing of the same question in a thread). Check annotations on candidate traces too: thumbs down and reviewer comments are gold.
3. **Token and cost hotspots**: distribution of tokens per trace; the p99 tail; which metadata slice (model, label, user) concentrates the spend; prompts that balloon context.
4. **Edge cases**: inputs far from the common distribution (very long, empty, non-primary language, unusual formats) and how the agent handled them.
5. **Behavior changes**: compare the recent window against the older export: output length, tool usage mix, model mix, refusal rate, latency. Anything that moved, find the first day it moved.
6. **Outliers**: the single weirdest traces by duration, cost, span count, and output size. Read them individually.

```bash
langwatch trace search -q "<keyword from a pattern>" --limit 10 --format json   # Chase a specific pattern
langwatch trace get <traceId>                                                   # Read a representative trace in full
langwatch trace get <traceId> -f json                                           # Every span, token count, and timing
```

For every pattern you claim, keep 2-3 example trace IDs as evidence. Never report a pattern without example traces behind it.

## Step 4: Build the Report

Write a single self-contained `agent-performance-report.html` in the project root (inline CSS, no external assets) with:

- **Executive summary**: the 3-5 findings that matter, each one sentence with its magnitude ("34% of errors come from date parsing on non-English inputs")
- One section per finding: the metric evidence (small tables, before/after numbers), what it means, and **links to example traces** so every claim is verifiable in one click
- A cost breakdown section, a reliability section, and a user-satisfaction section, even when healthy: say what was checked and that it looks fine
- A closing "recommended next steps" section ranked by impact

Trace links: `langwatch trace get` returns the platform URL for each trace; use those URLs directly. Anyone on the project team can open them.

Open the report path for the user and also summarize the top findings directly in the conversation, leading with the numbers.

## Step 5: Hand Off to Improvement

Diagnosis without treatment is just bad news. If the `agent-improve` skill is installed, run it on the findings right away: it turns each finding into tested hypotheses, scenario tests, evaluators, and PR-ready changes. Pass along the report — agent-improve uses these findings and trace examples as its evidence base.

## Common Mistakes

- Do NOT modify the agent's code, prompts, or any platform resource; this skill is read-only plus one report file
- Do NOT report a pattern without linked example traces; unverifiable claims are worthless
- Do NOT rely on aggregates alone; always read at least a handful of full traces per finding, the surprise is always in the details
- Do NOT analyze only the happy window; without a before/after comparison you cannot see behavior change
- Do NOT dump raw JSON at the user; the deliverable is the diagnosis and the report, written in plain language with numbers
- If the CLI returns an error, report the user-facing consequence (what couldn't be determined and why in plain terms), not the raw error text — an activity card already shows the underlying failure
