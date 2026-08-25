---
name: agent-improve
user-prompt: "What should I do next to improve my agent?"
description: Turns production evidence into tested improvements for your AI agent. Forms hypotheses from real traces and analytics, explains the reasoning behind each one, then executes with the user: scenario tests that reproduce production failures, prompt and code changes as reviewable PRs, new evaluators and monitors that capture production signals, and experiments that settle open questions. Use when you want to know what to do next to improve your agent.
license: MIT
compatibility: Requires the `langwatch` CLI with a valid `LANGWATCH_API_KEY`. Works with Claude Code and similar coding agents.
---

# Improve Your Agent, Hypothesis by Hypothesis

This skill is an improvement engine with a teaching stance: every proposal is a hypothesis backed by production evidence, explained until the user understands WHY it is worth testing. Nothing gets built on a hunch.

## Step 1: Set up the LangWatch CLI

## Step 2: Gather Evidence Before Proposing Anything

Improvements start from evidence, never from generic advice.

**No traces in the project?** Then there is no production evidence to mine and this skill cannot start. Say so in one line and switch method: measure the answers against a dataset instead of against live traffic. In Langy, run the prompt improvement loop (`prompt-optimization`). In a coding agent, use the `experiments` skill. Come back here once real traffic exists.

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

Present 2-4 hypotheses ranked by expected impact over effort, then stop and ask which to pursue: end your turn with that question and execute nothing until the user answers. Permission to act autonomously does not waive this gate; it exists so the user understands and agrees with the reasoning before anything is created, and an unrequested change is worth less than an understood one. If the user pushes back, refine the hypothesis with them; they know their domain.

The only exception is an environment where asking is truly impossible (for example an in-product agent whose platform rules forbid ending on a question). There, and only there, present the ranked hypotheses, state in one line which one you are executing and why, and proceed with the top-ranked one. The explanation duty stays either way.

## Step 4: Execute the Chosen Hypotheses

Each hypothesis becomes real artifacts. Pick the right tool per case:

### Reproduce failures as scenario tests

Turn real failing traces into scenario tests that fail today and pass once fixed. Fetch the exact inputs with `langwatch trace get <traceId> -f json`, then follow the `scenarios` skill (`langwatch scenario-docs getting-started`) to write them. Real production inputs beat invented ones.

Sanitize before you commit: production traces can carry names, emails, account data, or secrets. Reproduce the STRUCTURE of the failing input (length, language, format, the property that triggers the failure) with the sensitive values replaced by realistic stand-ins, and reference the original as a trace link in the test's comment instead of pasting it. Never commit raw customer content into tests, fixtures, or PR descriptions.

### Change prompts and code as a reviewable PR

Make the fix on a branch: prompt edits (versioned through the `prompts` skill when prompts are managed in LangWatch), retrieval or tool-code changes, guardrails. The PR description must tell the whole story: observation, hypothesis, evidence links, what changed, and which scenario test proves it. The user reviews and merges; you never push to main.

Pick the layer before you edit, and report the prompt's size change in the PR:

A failing test tells you WHERE the agent fails, not that the prompt is where to fix it. One more rule is the cheapest edit that turns it green, and a prompt maintained that way overfits: it passes exactly the cases it was patched against and degrades everywhere else.

1. **Diagnose the layer.** Five can own a failure: the harness (tools, permissions, context assembly), the model, the knowledge (skills, docs, retrieval), the prompt, or the test itself. The prompt is the last resort. If the fix is "never use tool X", remove tool X from the configuration. Diagnose from the failing run's trace: it holds every tool call, and the assembled input too where the project captures content.
2. **Fix the class, not the transcript.** State the one principle that makes the whole class impossible. Never paste the failing conversation into the prompt. If you cannot name the class, keep diagnosing.
3. **Prove it generalizes.** Re-run with varied wording. The simulator improvises, so a fix that survives one phrasing was a patch for that phrasing.
4. **Pair each prohibition with an overshoot test.** A "decline out-of-scope requests" rule needs a greeting scenario that fails if the agent declines a greeting.
5. **Refactor under green.** Merge overlapping rules, delete what a newer principle covers, re-run. Track prompt size like bundle size: pass rate holds while the prompt trends down.
6. **Keep the judge independent of the prompt.** Grade user outcomes and verified side effects, never the agent's own rules restated. A rubric that quotes the prompt grades obedience, not quality.

Your harness, codebase and model decide which levers exist. Full guide: [Improving your Agent](https://scenario.langwatch.ai/best-practices/improving-your-agent).

### Capture production signals with evaluators and monitors

When a hypothesis needs more production data, or a fixed issue must stay fixed, add detection:

```bash
langwatch evaluator list --format json        # What exists already
langwatch monitor create ...                  # Watch the signal on live traffic
```

Examples: an LLM-judge evaluator flagging stale-data answers, a monitor on refusal rate, a check for the specific failure mode you just fixed. These turn one-off findings into permanent signals for the next exploration.

### Settle open questions with experiments

When two approaches compete (two prompts, two models, two retrieval settings), run an experiment instead of arguing: build a dataset from real traces (`datasets` skill), then run it once per variant with `langwatch experiment run <slug> --param model=<variant>` and compare. A `--param name=value` pair is a constant value merged into every dataset row, so each run pins one variant against the same dataset.

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and note that upgrading the plan raises it. Point to the subscription settings on the platform, or to the license settings if `LANGWATCH_ENDPOINT` is set (self-hosted).
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

## Step 5: Close the Loop

After executing:

1. Run the new scenario tests and show the results, including failures
2. Summarize: hypothesis, what was built, what it proved, links to everything created
3. Point at the metric to watch and offer to re-check after the fix ships ("once merged, run `/agent-performance` again next week and compare")
4. Ask which hypothesis to tackle next, and stop cleanly when the user says enough

## Common Mistakes

- Do NOT propose changes without production evidence behind them; "best practice says so" is not a hypothesis
- Do NOT skip the explanation; if the user cannot restate why the hypothesis is plausible, you explained it badly
- Do NOT build all hypotheses at once; execute the agreed ones, show results, then continue
- Do NOT invent test inputs when real failing traces exist; reproduce their structure, with sensitive values swapped for stand-ins
- Do NOT paste raw customer content from traces into committed tests or PR text; link the trace instead
- Do NOT merge or push anything yourself; changes ship as PRs the user reviews
- Do NOT create evaluators or monitors for signals no one will act on; every artifact needs an owner and a purpose
- Do NOT grow the system prompt one rule per fixed failure; a prompt that only ever grows is accumulating patches, and it overfits to the tests it was patched against
