---
name: experiments
user-prompt: "Set up experiments for my agent"
description: Create and run LangWatch experiments for pre-deployment batch testing. Use when the user wants to test an agent against a dataset, compare prompts or models, benchmark quality, detect regressions, or add a CI quality gate. Do not use for production monitoring or guardrails.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
---

# Run Experiments for Your Agent

Experiments are pre-deployment batch tests. They run an application over a dataset and compare outputs with reusable evaluators. They are appropriate for prompt and model comparisons, regression tests, benchmarks, and CI quality gates.

## Hand Off Production Evaluation Requests

If the user wants to score live traces or threads, monitor production quality, or block unsafe traffic, this is the wrong workflow.

1. If the `online-evaluations` skill is available, load it and follow it now.
2. Otherwise, tell the user to install it with:

   ```bash
   npx skills@1.5.19 add langwatch/skills/online-evaluations
   ```

Do not configure a monitor or guardrail from this skill.

## Experiments and Scenarios

Use experiments for many single input and output examples with measurable results. Use the `scenarios` skill for end-to-end, multi-turn behavior and tool-calling sequences.

## Determine Scope

For a general request such as "test my agent":

1. Read the agent code, system prompt, tools, and relevant git history.
2. Identify the behavior most likely to regress.
3. Create a domain-specific dataset.
4. Select evaluators that measure the intended behavior, or a comparison when the goal is picking a winner between candidates.
5. Create and run a real experiment.
6. Interpret the results and recommend concrete improvements.

For a targeted request, focus on that behavior and still run the resulting experiment.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and note that upgrading the plan raises it. Point to the subscription settings on the platform, or to the license settings if the CLI is pointed at a self-hosted endpoint. Read the endpoint the CLI actually uses, which can come from `.env`, from the process environment, or from the saved CLI configuration.
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

## Prerequisites

Read the experiment documentation before writing code:

```bash
langwatch docs evaluations/experiments/overview
langwatch docs evaluations/experiments/sdk
```

## Build a Domain-Specific Dataset

The examples must match what the application actually does. Read the system prompt, function signatures, tools, and knowledge sources first.

Good examples resemble real requests to this application and cover normal cases, edge cases, and past failures. Never use generic trivia such as "What is 2+2?" or "What is the capital of France?" unless the application itself is a trivia system.

If an existing LangWatch dataset is appropriate, inspect it with `langwatch dataset list --format json` and `langwatch dataset get --help`. Otherwise create the dataset in code or use the `datasets` skill.

## Create the Experiment

Use the SDK that matches the codebase. Keep credentials in environment variables and use the project's existing dependency manager.

### Python

```python
import langwatch
import pandas as pd

dataset = pd.DataFrame([
    {
        "input": "A realistic request for this application",
        "expected_output": "The expected behavior",
    },
])

experiment = langwatch.experiment.init("agent-regression")

for index, row in experiment.loop(dataset.iterrows()):
    response = my_agent(row["input"])
    experiment.evaluate(
        "ragas/response_relevancy",
        index=index,
        data={"input": row["input"], "output": response},
        settings={"model": "openai/gpt-6-luna", "max_tokens": 2048},
    )
```

### TypeScript

```typescript
import { LangWatch } from "langwatch";

const langwatch = new LangWatch();
const dataset = [
  {
    input: "A realistic request for this application",
    expectedOutput: "The expected behavior",
  },
];

const experiment = await langwatch.experiments.init("agent-regression");

await experiment.run(dataset, async ({ item, index }) => {
  const response = await myAgent(item.input);
  await experiment.evaluate("ragas/response_relevancy", {
    index,
    data: { input: item.input, output: response },
    settings: { model: "openai/gpt-6-luna", max_tokens: 2048 },
  });
});
```

Read `langwatch docs evaluations/evaluators/list` before choosing an evaluator, and take the type slug from `langwatch evaluator types --format json`, never from memory. If an evaluation fails with a `validation_error` naming the slug and an `expected` list, correct it from that list and retry once. Reuse project evaluators when appropriate. A scoring function is part of the experiment, not the experiment itself.

## Compare Targets to Pick a Winner

An evaluator answers "does this output pass?". A comparison answers "which of these is better?". For subjective quality, a judge ranking candidates side by side is usually more informative than each one getting an absolute score on its own.

Register one target per candidate inside the loop, then compare the row once. Every target that recorded an output for the row is a candidate, so the candidates are never named twice, and the verdict is recorded against the row, so the results page renders it with no extra logging.

### Python

```python
for index, row in experiment.loop(dataset.iterrows()):
    with experiment.target("gpt-6-luna"):
        experiment.log_response(call_gpt(row["input"]))

    with experiment.target("claude-sonnet-5"):
        experiment.log_response(call_claude(row["input"]))

    verdict = experiment.compare(index, input=row["input"])
```

Inside an async loop, await `experiment.acompare(...)`, which takes the same options.

### TypeScript

```typescript
await experiment.run(dataset, async ({ item, index }) => {
  await Promise.all([
    experiment.withTarget("gpt-6-luna", () => callGpt(item.input)),
    experiment.withTarget("claude-sonnet-5", () => callClaude(item.input)),
  ]);

  const verdict = await experiment.compare({ index, input: item.input });
});
```

Pass `golden` with a known-good answer to judge every candidate against it. Leave it out, which is the default, and the candidates are judged on their own merits.

Read `verdict.status`, and keep its five answers apart:

- `decided`: the judge picked a winner, named in `verdict.winner`.
- `tie`: the judge compared the candidates and found none better than the rest.
- `inconclusive`: no winner was established, which with the default second pass over the reversed candidate order means the two passes disagreed.
- `skipped`: the row had fewer than two outputs, so no judge ran.
- `error`: the judge failed, so nothing was measured about the candidates at all.

A tie, an inconclusive row and an errored row are three different answers. Reporting any of them as one of the others claims a measurement the run never made.

`prompt` replaces the judge prompt verbatim, with `{input}`, `{golden}` and `{candidates}` placeholders. Leave it unset unless the user asks for their own, because unset is what lets the judge use the prompt matching what each row carries. The remaining judge options are in `langwatch docs evaluations/experiments/sdk`.

## Run and Verify

Always execute the experiment. An unrun experiment is incomplete.

- Python script: run it with the project's Python environment.
- Notebook: execute all cells, for example with `jupyter nbconvert --to notebook --execute`.
- TypeScript: run it with the project's package manager, for example `pnpm exec tsx experiment.ts`.

After it runs, verify the result with the CLI:

```bash
langwatch experiment list --format json
```

If the CLI supports a more specific read or run for the installed version, discover it with `langwatch experiment --help` before using it.

## Use Experiments to Measure a Change

An experiment is the yardstick for a prompt, model, retrieval or code change. Run the current version first, then the candidate on the same dataset and evaluators. When the application samples at non-zero temperature, run each version more than once (`langwatch experiment run <slug>` again, or the script again) and compare per row: a row that fails on one run and passes on the next is variation, not a regression. Two runs of the same version can differ by more than the change you are testing.
`langwatch experiment run <slug> --repeat <n> --wait` (1 to 5) runs every row n times in one run and prints each row's pass rate, so one command shows which rows pass only some of the time.

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

## Consultant Mode

After delivering initial results, transition to consultant mode to help the user get maximum value.

**Phase 1: read first.** Before generating ANY content: read the codebase end-to-end (every system prompt, function, tool definition), study git history for agent-related changes (`git log --oneline -30`, then drill into prompt/agent/eval-related commits because the WHY in commit messages matters more than the WHAT), and read READMEs and comments for domain context.

**Phase 2: quick wins.** Generate best-effort content based on what you learned. Run the tests and iterate, but stop after two attempts at the same failure and report what is blocking it rather than repeating the run. Show the user what works.

**Phase 3: go deeper.** Once Phase 2 lands, summarize what you delivered, then suggest 2-3 specific improvements grounded in the codebase: domain edge cases, areas that need expert terminology or real data, integration points (APIs, databases, file uploads), or regression patterns from git history that deserve test coverage. Ask light questions with options, not open-ended ("Want scenarios for X or Y?", "I noticed Z was a recurring issue. Add a regression test?", "Do you have real customer queries I could use?"). Respect "that's enough" and wrap up cleanly.

Do NOT ask permission before Phase 1 and 2. Deliver value first. Do NOT ask generic questions or overwhelm with too many suggestions. Do NOT generate generic datasets. Everything must reflect the actual domain.

## Common Mistakes

- Do not configure production monitoring or guardrails from this skill.
- Do not call a batch run an online evaluation.
- Do not use placeholder datasets.
- Do not report an inconclusive or errored comparison as a tie.
- Do not guess SDK APIs when the installed documentation is available.
- Do not stop after writing the experiment. Run it and inspect the real result.
- Do not declare a winner from one run of each version when outputs vary; compare repeated runs per row.
