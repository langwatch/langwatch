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
4. Select evaluators that measure the intended behavior.
5. Create and run a real experiment.
6. Interpret the results and recommend concrete improvements.

For a targeted request, focus on that behavior and still run the resulting experiment.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits. If 3 resources of the relevant type are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and direct the user to upgrade at https://app.langwatch.ai/settings/subscription.
- Do NOT delete existing resources to make room or repurpose an existing resource to evade the limit.

If `LANGWATCH_ENDPOINT` is set in `.env`, the user is self-hosted. Direct them to `{LANGWATCH_ENDPOINT}/settings/license` instead.

## Prerequisites

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

So for anything in these skills: make sure `LANGWATCH_API_KEY` for a real, shared project is in the project's `.env`. If it is missing, ask the user for it (they can mint a key for a specific project at https://app.langwatch.ai/authorize). Do NOT run `langwatch login` to pick a project, and never default to a personal project. If `LANGWATCH_ENDPOINT` is set, they are self-hosted, use that endpoint instead of app.langwatch.ai.

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
        "ragas/answer_relevancy",
        index=index,
        data={"input": row["input"], "output": response},
        settings={"model": "openai/gpt-5-mini", "max_tokens": 2048},
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
  await experiment.evaluate("ragas/answer_relevancy", {
    index,
    data: { input: item.input, output: response },
    settings: { model: "openai/gpt-5-mini", max_tokens: 2048 },
  });
});
```

Read `langwatch docs evaluations/evaluators/list` before choosing an evaluator. Reuse project evaluators when appropriate. A scoring function is part of the experiment, not the experiment itself.

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

## Consultant Mode

After delivering initial results, transition to consultant mode to help the user get maximum value.

**Phase 1: read first.** Before generating ANY content: read the codebase end-to-end (every system prompt, function, tool definition), study git history for agent-related changes (`git log --oneline -30`, then drill into prompt/agent/eval-related commits because the WHY in commit messages matters more than the WHAT), and read READMEs and comments for domain context.

**Phase 2: quick wins.** Generate best-effort content based on what you learned. Run everything, iterate until green. Show the user what works and create the a-ha moment.

**Phase 3: go deeper.** Once Phase 2 lands, summarize what you delivered, then suggest 2-3 specific improvements grounded in the codebase: domain edge cases, areas that need expert terminology or real data, integration points (APIs, databases, file uploads), or regression patterns from git history that deserve test coverage. Ask light questions with options, not open-ended ("Want scenarios for X or Y?", "I noticed Z was a recurring issue. Add a regression test?", "Do you have real customer queries I could use?"). Respect "that's enough" and wrap up cleanly.

Do NOT ask permission before Phase 1 and 2. Deliver value first. Do NOT ask generic questions or overwhelm with too many suggestions. Do NOT generate generic datasets. Everything must reflect the actual domain.

## Common Mistakes

- Do not configure production monitoring or guardrails from this skill.
- Do not call a batch run an online evaluation.
- Do not use placeholder datasets.
- Do not guess SDK APIs when the installed documentation is available.
- Do not stop after writing the experiment. Run it and inspect the real result.
