---
name: evaluations
user-prompt: "Set up evaluations for my agent"
description: Set up comprehensive evaluations for your AI agent with LangWatch — experiments (batch testing), evaluators (scoring functions), datasets, online evaluation (production monitoring), and guardrails (real-time blocking). Supports both code (SDK) and platform (CLI) approaches. Use when the user wants to evaluate, test, benchmark, monitor, or safeguard their agent.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
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

See [Plan Limits](_shared/plan-limits.md).

## Prerequisites

See [CLI Setup](_shared/cli-setup.md).

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

See [Consultant Mode](_shared/consultant-mode.md).

## Common Mistakes

- Do NOT say "run an evaluation" — be specific: experiment, monitor, or guardrail
- Do NOT use generic/placeholder datasets — generate domain-specific examples
- Do NOT skip running the experiment to verify it works
- Monitors **measure** (async), guardrails **act** (sync, via code with `as_guardrail=True`)
