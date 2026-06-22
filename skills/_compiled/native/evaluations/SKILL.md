---
name: evaluations
description: "Set up comprehensive evaluations for your AI agent with LangWatch — experiments (batch testing), evaluators (scoring functions), datasets, online evaluation (production monitoring), and guardrails (real-time blocking). Supports both code (SDK) and platform (CLI) approaches. Use when the user wants to evaluate, test, benchmark, monitor, or safeguard their agent."
---

# Set Up Evaluations for Your Agent

LangWatch Evaluations is a comprehensive QA system. Map the user's request to one branch:

| User says... | They need... | Go to... |
|---|---|---|
| "test my agent", "benchmark", "compare models" | **Experiments** | Step A |
| "monitor production", "track quality", "block harmful content", "safety" | **Online Evaluation** (includes guardrails) | Step B |
| "create an evaluator", "scoring function" | **Evaluators** | Step C |
| "create a dataset", "test data" | **Datasets** | Step D |
| "evaluate" (ambiguous) | Ask: "batch test or production monitoring?" | - |

## Where Evaluations Fit

Evaluations sit at the **component level** of the testing pyramid — they test specific aspects of an agent with many input/output examples. Different from scenarios (end-to-end multi-turn).

Use evaluations when you have many examples with clear correct answers, or for CI quality gates. Use scenarios for multi-turn behavior and tool-calling sequences.

## Determine Scope

If the user's request is **general** ("set up evaluations"):

- Read the codebase to understand the agent
- Study git history to understand what changed and why — focus on agent behavior changes, prompt tweaks, bug fixes. Read commit messages for context.
- Set up an experiment + evaluator + dataset
- After the experiment is working, summarize results and suggest improvements (consultant mode — see end of skill).

If the user's request is **specific** ("add a faithfulness evaluator"):

- Focus on the specific need
- Create the targeted evaluator, dataset, or experiment
- Verify it works

## Detect Context

If you're in a codebase (`package.json`, `pyproject.toml`, etc.) — use the SDK for experiments and guardrails; use the CLI for evaluators, datasets, monitors. If there is no codebase, drive everything via the CLI. If ambiguous, ask the user.

Some features are code-only (experiments, guardrails) and some are platform-only (monitors). Evaluators work on both surfaces.

## Plan Limits

LangWatch's free plan has limits on prompts, scenarios, evaluators, experiments, and datasets. When you hit a limit, the API returns `"Free plan limit of N reached..."` with an upgrade link.

How to handle:

- Work within the limits — if 3 scenarios are allowed, create 3 meaningful ones, not 10.
- Make every creation count: each one should demonstrate clear value.
- Show what works FIRST. If you hit a limit, summarize what was accomplished and direct the user to upgrade at https://app.langwatch.ai/settings/subscription.
- Do NOT delete existing resources to make room, and do NOT reuse a scenario set to cram in more tests.

If `LANGWATCH_ENDPOINT` is set in `.env`, the user is self-hosted — direct them to `{LANGWATCH_ENDPOINT}/settings/license` instead

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

Then read the evaluations overview:

```bash
langwatch docs evaluations/overview
```

## Step A: Experiments (Batch Testing) — Code Approach

Create a script or notebook that runs the agent against a dataset and measures quality.

1. Read the SDK docs:
   ```bash
   langwatch docs evaluations/experiments/sdk
   ```
2. Analyze the agent code to understand its inputs/outputs.
3. Create a dataset with examples that look like real production data — domain-realistic, not generic.
4. Create the experiment file:

**Python (Jupyter):**

```python
import langwatch
import pandas as pd

data = {
    "input": ["domain-specific question 1", "domain-specific question 2"],
    "expected_output": ["expected answer 1", "expected answer 2"],
}
df = pd.DataFrame(data)

evaluation = langwatch.experiment.init("agent-evaluation")

for index, row in evaluation.loop(df.iterrows()):
    response = my_agent(row["input"])
    evaluation.evaluate(
        "ragas/answer_relevancy",
        index=index,
        data={"input": row["input"], "output": response},
        settings={"model": "openai/gpt-5-mini", "max_tokens": 2048},
    )
```

**TypeScript:**

```typescript
import { LangWatch } from "langwatch";

const langwatch = new LangWatch();
const dataset = [
  { input: "domain-specific question", expectedOutput: "expected answer" },
];

const evaluation = await langwatch.experiments.init("agent-evaluation");

await evaluation.run(dataset, async ({ item, index }) => {
  const response = await myAgent(item.input);
  await evaluation.evaluate("ragas/answer_relevancy", {
    index,
    data: { input: item.input, output: response },
    settings: { model: "openai/gpt-5-mini", max_tokens: 2048 },
  });
});
```

5. Run it. ALWAYS execute the experiment after creating it — an unrun experiment is useless. For Python notebooks: run the cells, or `jupyter nbconvert --to notebook --execute`. For TypeScript: `npx tsx experiment.ts`.

## Step B: Online Evaluation (Production Monitoring & Guardrails)

### Platform mode: Monitors (continuous async scoring)

```bash
langwatch docs evaluations/online-evaluation/overview
```

Create monitors via the CLI (`langwatch monitor --help` for the flag set). Optionally configure further at https://app.langwatch.ai → Evaluations → Monitors.

### Code mode: Guardrails (synchronous blocking)

```bash
langwatch docs evaluations/guardrails/code-integration
```

Add guardrail checks in agent code:

```python
import langwatch

@langwatch.trace()
def my_agent(user_input):
    guardrail = langwatch.evaluation.evaluate(
        "azure/jailbreak",
        name="Jailbreak Detection",
        as_guardrail=True,
        data={"input": user_input},
    )
    if not guardrail.passed:
        return "I can't help with that request."
    ...
```

Key distinction: Monitors **measure** (async). Guardrails **act** (sync via `as_guardrail=True`).

## Step C: Evaluators (Scoring Functions)

Read the docs first:

```bash
langwatch docs evaluations/evaluators/overview
langwatch docs evaluations/evaluators/list      # Browse available evaluators
```

In code, call evaluators via the SDK as shown in Step A. To create or manage evaluators on the platform, use `langwatch evaluator --help`. If unsure which `--type` values are valid, run `langwatch evaluator create --help` first.

If you need an LLM-as-judge evaluator, verify a model provider is configured (`langwatch model-provider list`).

## Step D: Datasets

Read the docs first:

```bash
langwatch docs datasets/overview
langwatch docs datasets/programmatic-access
langwatch docs datasets/ai-dataset-generation
```

Use `langwatch dataset --help` for create/upload/download. Generate data tailored to the agent:

| Agent type | Dataset examples |
|---|---|
| Chatbot | Realistic user questions matching the bot's persona |
| RAG pipeline | Questions with expected answers testing retrieval quality |
| Classifier | Inputs with expected category labels |
| Code assistant | Coding tasks with expected outputs |
| Customer support | Support tickets and customer questions |
| Summarizer | Documents with expected summaries |

CRITICAL: The dataset MUST be specific to what the agent ACTUALLY does. Before generating any data:

1. Read the agent's system prompt word by word
2. Read the agent's function signatures and tool definitions
3. Understand the agent's domain, persona, and constraints

Then generate data reflecting EXACTLY this agent's real-world usage. NEVER use generic examples like "What is 2+2?", "What is the capital of France?", or "Explain quantum computing" — every example must be something a real user of THIS specific agent would say.

## Consultant Mode

Once the experiment is working, summarize results and suggest 2-3 domain-specific improvements based on what you learned from the codebase.

After delivering initial results, transition to consultant mode to help the user get maximum value.

**Phase 1 — read first.** Before generating ANY content: read the codebase end-to-end (every system prompt, function, tool definition), study git history for agent-related changes (`git log --oneline -30`, then drill into prompt/agent/eval-related commits — the WHY in commit messages matters more than the WHAT), and read READMEs and comments for domain context.

**Phase 2 — quick wins.** Generate best-effort content based on what you learned. Run everything, iterate until green. Show the user what works — the a-ha moment.

**Phase 3 — go deeper.** Once Phase 2 lands, summarize what you delivered, then suggest 2-3 specific improvements grounded in the codebase: domain edge cases, areas that need expert terminology or real data, integration points (APIs, databases, file uploads), or regression patterns from git history that deserve test coverage. Ask light questions with options, not open-ended ("Want scenarios for X or Y?", "I noticed Z was a recurring issue — add a regression test?", "Do you have real customer queries I could use?"). Respect "that's enough" and wrap up cleanly.

Do NOT ask permission before Phase 1 and 2 — deliver value first. Do NOT ask generic questions or overwhelm with too many suggestions. Do NOT generate generic datasets — everything must reflect the actual domain.

## Common Mistakes

- Do NOT say "run an evaluation" — be specific: experiment, monitor, or guardrail
- Do NOT use generic/placeholder datasets — generate domain-specific examples
- Do NOT skip running the experiment to verify it works
- Monitors **measure** (async), guardrails **act** (sync, via code with `as_guardrail=True`)
