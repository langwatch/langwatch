---
name: agent-improvement
user-prompt: "What should I do next to improve my agent?"
description: Turns production evidence into tested improvements for your AI agent. Forms hypotheses from real traces and analytics, explains the reasoning behind each one, then executes with the user: scenario tests that reproduce production failures, prompt and code changes as reviewable PRs, new evaluators and monitors that capture production signals, and experiments that settle open questions. Use when you want to know what to do next to improve your agent.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`. Works with Claude Code and similar coding agents.
---

# Improve Your Agent, Hypothesis by Hypothesis

This skill is an improvement engine with a teaching stance: every proposal is a hypothesis backed by production evidence, explained until the user understands WHY it is worth testing. Nothing gets built on a hunch.

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

**Projects and API keys: target a real project, not a personal one.**

LangWatch has two kinds of project:

- **Team / shared projects**: real projects inside an organization. Evaluations, experiments, prompts, datasets, simulations and instrumentation must always target one of these.
- **Personal projects**: a private "My Workspace" scratch space tied to a single user. Never send a user's evaluations, experiments or production traces here: it is for personal exploration only and is easily confused with a real project.

And two ways to authenticate:

- **A project API key in `.env`** (`LANGWATCH_API_KEY`): the credential everything in these skills uses. It is scoped to one real project. This is the default; prefer it unless the user explicitly asks for something else.
- **`langwatch login --device` (AI-tools / SSO)**: a personal device session for wrapping coding assistants (`langwatch claude`, `langwatch codex`, …). It is NOT for evaluations, prompts, datasets, scenarios or SDK instrumentation, and it points at a personal workspace. Do not run it to set up the work in these skills.

So for anything in these skills: make sure `LANGWATCH_API_KEY` for a real, shared project is in the project's `.env`. If it is missing, ask the user for it (they can mint a key for a specific project at https://app.langwatch.ai/authorize). Do NOT run `langwatch login` to pick a project, and never default to a personal project. If `LANGWATCH_ENDPOINT` is set, they are self-hosted, use that endpoint instead of app.langwatch.ai.

## Step 2: Gather Evidence Before Proposing Anything

Improvements start from evidence, never from generic advice.

1. **Use an existing diagnosis when there is one.** Look for `agent-performance-report.html` (or ask if a recent diagnosis exists). If present, read it and extract the findings and their example trace IDs.
2. **No diagnosis available?** Run a focused evidence sweep yourself:

```bash
langwatch analytics query --metric trace-count --format json     # Volume and trend
langwatch analytics query --metric eval-pass-rate --format json  # Quality trend, if evaluators exist
langwatch analytics query --metric total-cost --group-by metadata.model --format json
langwatch trace export --format jsonl --limit 500 -o evidence.jsonl
langwatch trace search -q "error" --limit 10 --format json
```

Mine the export for failure clusters, dissatisfied users, cost concentration, and odd behavior, and keep 2-3 example trace IDs per issue. For the full treatment, suggest running `/agent-performance` first (install with `npx skills add langwatch/skills/agent-performance`).

3. **Read the codebase too.** The fix for a production pattern usually lives in a prompt or a code path: read the system prompts, the tool definitions, and `git log --oneline -30` so proposals name the exact file and line to change.

## Step 3: Form Hypotheses and Explain Them

For each significant finding, build an explicit hypothesis chain and present it to the user:

- **Observation**: what the traces show, with linked examples ("11% of conversations rephrase the same question twice, examples: trace A, trace B")
- **Hypothesis**: the suspected cause ("the retrieval step returns stale documents for date-sensitive questions")
- **Proposed test**: how to prove or disprove it cheaply (a scenario test, an experiment, an evaluator watching prod)
- **Proposed fix if confirmed**: the prompt, code, or configuration change
- **Expected effect**: which metric should move, by roughly how much

Present 2-4 hypotheses ranked by expected impact over effort. Ask which to pursue: the user must understand and agree with the reasoning before anything is created. If the user pushes back, refine the hypothesis with them; they know their domain.

## Step 4: Execute the Chosen Hypotheses

Each hypothesis becomes real artifacts. Pick the right tool per case:

### Reproduce failures as scenario tests

Turn real failing traces into scenario tests that fail today and pass once fixed. Fetch the exact inputs with `langwatch trace get <traceId> -f json`, then follow the `scenarios` skill (`langwatch scenario-docs getting-started`) to write them. Real production inputs beat invented ones.

### Change prompts and code as a reviewable PR

Make the fix on a branch: prompt edits (versioned through the `prompts` skill when prompts are managed in LangWatch), retrieval or tool-code changes, guardrails. The PR description must tell the whole story: observation, hypothesis, evidence links, what changed, and which scenario test proves it. The user reviews and merges; you never push to main.

### Capture production signals with evaluators and monitors

When a hypothesis needs more production data, or a fixed issue must stay fixed, add detection:

```bash
langwatch evaluator list --format json        # What exists already
langwatch monitor create ...                  # Watch the signal on live traffic
```

Examples: an LLM-judge evaluator flagging stale-data answers, a monitor on refusal rate, a check for the specific failure mode you just fixed. These turn one-off findings into permanent signals for the next exploration.

### Settle open questions with experiments

When two approaches compete (two prompts, two models, two retrieval settings), run an experiment instead of arguing: build a dataset from real traces (`datasets` skill), then `langwatch experiment run` both variants and compare. Numbers close debates.

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits — if 3 scenarios are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and direct the user to upgrade at https://app.langwatch.ai/settings/subscription.
- Do NOT delete existing resources to make room, and do NOT reuse a scenario set to cram in more tests.

If `LANGWATCH_ENDPOINT` is set in `.env`, the user is self-hosted — direct them to `{LANGWATCH_ENDPOINT}/settings/license` instead

## Step 5: Close the Loop

After executing:

1. Run the new scenario tests and show the results honestly, including failures
2. Summarize: hypothesis, what was built, what it proved, links to everything created
3. Point at the metric to watch and offer to re-check after the fix ships ("once merged, run `/agent-performance` again next week and compare")
4. Ask which hypothesis to tackle next, and stop cleanly when the user says enough

## Common Mistakes

- Do NOT propose changes without production evidence behind them; "best practice says so" is not a hypothesis
- Do NOT skip the explanation; if the user cannot restate why the hypothesis is plausible, you explained it badly
- Do NOT build all hypotheses at once; execute the agreed ones, show results, then continue
- Do NOT invent test inputs when real failing traces exist; reproduce reality
- Do NOT merge or push anything yourself; changes ship as PRs the user reviews
- Do NOT create evaluators or monitors for signals nobody will act on; every artifact needs an owner and a purpose
