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
- **Expected effect**: which metric should move, by roughly how much, and which items should not move at all

Rank the hypotheses by expected impact over effort. Before ranking, check each one against the evidence: a hypothesis that the failing traces do not show is a guess, however plausible it sounds.

When the user can answer, stop and ask which to pursue: end your turn with that question and execute nothing until they answer. Permission to act autonomously does not waive this step; it exists so the user understands and agrees with the reasoning before anything is created, and an unrequested change is worth less than an understood one. If the user pushes back, refine the hypothesis with them; they know their domain.

When your instructions say to proceed without asking (an in-product assistant, an unattended or scheduled run), the step still happens in writing: the ranked hypotheses, the one you are taking first, and why. Then proceed. The explanation duty stays either way.

## Step 4: Execute the Chosen Hypotheses

Each hypothesis becomes real artifacts. Pick the right tool per case:

### Reproduce failures as scenario tests

Turn real failing traces into scenario tests that reproduce the failure. Run them more than once before you trust them: a scenario that fails on every run reproduces the problem, one that fails on some runs shows an unstable behaviour, which is also worth fixing, but measured by its pass rate. Read what happened with `langwatch trace get <traceId> -f json`, then follow the `scenarios` skill (`langwatch scenario-docs getting-started`) to write them. The trace tells you what the conversation did; the scenario reproduces it with test data of your own.

A scenario is a simulation, so its inputs are test data and never the customer's. Invent every identifier it needs, the names, emails, order, ticket and account ids, and keep only the shape of the original: its length, language, format and the property that triggers the failure. A `[REDACTED]` value is the same case with nothing to recover, so invent a stand-in rather than asking anyone for the original. The real conversation stays in the trace, linked from the test or the scenario description, and raw customer content never reaches a scenario, a test, a fixture or a PR.

Write the invented identifier into the situation instead of leaving a role unnamed. A situation that says "a colleague" leaves the simulated user to make an address up, and it makes up a different one every run, so the run stops being reproducible. Naming the colleague and the address the customer would have typed pins it for every run.

Then make the lookup resolve. When the agent looks one of those identifiers up, its fixtures or test data need a record to find: use an identifier the data already carries, or add the record in the same change. A scenario whose lookup always misses proves the miss rather than the behaviour you are chasing, and it can never go green.

### Measure every change

Improving an agent works like an experiment, whatever the layer you change: a prompt, code, retrieval, a tool or a test. One attempt is rarely the answer, and an unmeasured change is a guess.

1. **Set an attempts budget.** Before the first change, decide how many hypotheses the problem is worth, given what one measurement costs (a dataset run, a scenario suite, a CI cycle). Say the number and the reason in one line. Revise it as you learn: a cheap measurement or a promising lead earns more attempts, an expensive or flat one fewer.
2. **Measure the baseline first,** with what the environment offers: a platform experiment, a scenario run with `--repeat`, the repository's own tests and linters, its CI. That measurement is the yardstick for every attempt, so note the items, the number of runs and the evaluators.
3. **Read the variation before you call anything a failure.** A model sampling at non-zero temperature, a simulated user and an LLM judge all vary between runs. Run each item more than once and read its pass rate ("failed 3 of 3", "failed 1 of 3"), not a single verdict. Diagnose the items that fail consistently first. An item that passes on some runs and fails on others is an unstable behaviour: look for what makes it unstable (an ambiguous instruction, a retrieval step that sometimes misses), never patch the one bad output.
4. **State the hypothesis before the change:** the cause, the change, and what it predicts will move. For example: "refund answers quote the old policy because retrieval ranks the outdated page first; ranking recent pages higher should raise the pass rate on policy questions and leave the rest unchanged." Rank the hypotheses you considered and say why you chose this one. When the user is there to answer, let them choose. When no one can answer (an in-product assistant, an unattended run), write the ranking and your choice with its reason, then proceed.
5. **Change one thing on a branch and measure the candidate exactly like the baseline:** same items, same number of runs, same evaluators. Compare per item, not only the total.
6. **Keep some items out of the loop.** Build the fix from part of the failing items and check it on items you did not read. A fix that lifts only the items it was built from is fitted to them.
7. **Open a pull request only on a measured win.** Its description carries the hypothesis, the baseline and candidate results over the same items, and the runs that produced them. When the candidate does not win, open nothing: say what the result taught you, adjust, and take the next hypothesis. When nothing in reach can measure the change (the agent cannot run here and no platform run reaches the branch), say so and present the change as untested, never as an improvement.
8. **Stop when the budget is spent or the results stop moving,** and report every attempt: hypothesis, result, verdict. "Nothing beat the baseline, and this is what we learned" is a result.

**Fix the class, in every layer.** Code that recognises the evaluation questions (a keyword check, a hardcoded answer, a special case for one input) is not a fix. It passes the items it names and breaks the ones that look like them. Ask whether the change would help a new question of the same kind, one not in the test set. If not, keep diagnosing.

**Tests you write are not the evidence.** You may write and edit tests, scenarios, datasets and expected answers. A test you wrote checks that the code does what you meant, not that what you meant is right. A grading change made in the same piece of work as the agent change never counts as evidence for that change: disclose it in the pull request, justify it against real traces or conversations, and measure the agent change against the grading that existed before.

### Change prompts and code as a reviewable PR

Make the fix on a branch: prompt edits (versioned through the `prompts` skill when prompts are managed in LangWatch), retrieval or tool-code changes, guardrails. Open the PR once the measurement above shows a win. The description tells the whole story: observation, hypothesis, evidence links, what changed, and the baseline and candidate results that show it helped. The user reviews and merges; you never push to main.

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

When two approaches compete (two prompts, two models, two retrieval settings), run an experiment instead of arguing: build a dataset from real traces (`datasets` skill), then run it per variant with `langwatch experiment run <slug> --param model=<variant>`, more than once when outputs vary, and compare per item. A `--param name=value` pair is a constant value merged into every dataset row, so each run pins one variant against the same dataset.

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and note that upgrading the plan raises it. Point to the subscription settings on the platform, or to the license settings if the CLI is pointed at a self-hosted endpoint. Read the endpoint the CLI actually uses, which can come from `.env`, from the process environment, or from the saved CLI configuration.
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

## Step 5: Close the Loop

After executing:

1. Report every attempt: hypothesis, baseline and candidate results, verdict, including the ones that did not win
2. Summarize what was built, what it proved, and links to everything created
3. Point at the metric to watch and offer to re-check after the fix ships ("once merged, run `/agent-performance` again next week and compare")
4. Ask which hypothesis to tackle next, and stop cleanly when the user says enough

## Common Mistakes

- Do NOT propose changes without production evidence behind them; "best practice says so" is not a hypothesis
- Do NOT skip the explanation; if the user cannot restate why the hypothesis is plausible, you explained it badly
- Do NOT build all hypotheses at once; one change per measurement, or you cannot tell which one moved the number
- Do NOT open a PR the measurement did not support, and do not call one-off failures bugs before repeated runs say they are consistent
- Do NOT make code recognise the evaluation questions (keyword checks, hardcoded answers); that is overfitting in code, the same as a prompt patched per failure
- Do NOT copy a customer's identifiers out of a trace into a scenario, a test or a PR; invent stand-ins, name them in the situation, and seed the record the agent looks up
- Do NOT paste raw customer content from traces into committed tests or PR text; link the trace instead
- Do NOT merge or push anything yourself; changes ship as PRs the user reviews
- Do NOT create evaluators or monitors for signals no one will act on; every artifact needs an owner and a purpose
- Do NOT grow the system prompt one rule per fixed failure; a prompt that only ever grows is accumulating patches, and it overfits to the tests it was patched against
