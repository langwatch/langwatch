---
name: evaluations
user-prompt: "Set up evaluations for my agent"
description: Set up comprehensive evaluations for your AI agent with LangWatch — experiments (batch testing), evaluators (scoring functions), datasets, online evaluation (production monitoring), and guardrails (real-time blocking). Supports both code (SDK) and platform (CLI) approaches. Use when the user wants to evaluate, test, benchmark, monitor, or safeguard their agent.
license: MIT
compatibility: Works with Claude Code and similar AI assistants. The `langwatch` CLI is the only interface for platform operations and documentation.
---

# Set Up Evaluations for Your Agent

LangWatch Evaluations is a comprehensive quality assurance system. Understand which part the user needs:

| User says... | They need... | Go to... |
|---|---|---|
| "test my agent", "benchmark", "compare models" | **Experiments** | Step A |
| "monitor production", "track quality", "block harmful content", "safety" | **Online Evaluation** (includes guardrails) | Step B |
| "create an evaluator", "scoring function" | **Evaluators** | Step C |
| "create a dataset", "test data" | **Datasets** | Step D |
| "evaluate" (ambiguous) | Ask: "batch test or production monitoring?" | - |

## Where Evaluations Fit

Evaluations sit at the **component level of the testing pyramid** — they test specific aspects of your agent with many input/output examples. This is different from scenarios (end-to-end multi-turn conversation testing).

Use evaluations when:
- You have many examples with clear correct/incorrect answers
- Testing RAG retrieval accuracy
- Benchmarking classification, routing, or detection tasks
- Running CI/CD quality gates

Use scenarios instead when:
- Testing multi-turn agent conversation behavior
- Validating complex tool-calling sequences
- Checking agent decision-making in realistic situations

For onboarding, create 1-2 Jupyter notebooks (or scripts) maximum. Focus on generating domain-realistic data that's as close to real-world inputs as possible.

## Determine Scope

If the user's request is **general** ("set up evaluations", "evaluate my agent"):
- Read the full codebase to understand the agent's architecture
- Study git history to understand what changed and why — focus on agent behavior changes, prompt tweaks, bug fixes. Read commit messages for context.
- Set up comprehensive evaluation coverage (experiment + evaluators + dataset)
- After the experiment is working, transition to consultant mode: summarize results and suggest domain-specific improvements. See [Consultant Mode](_shared/consultant-mode.md).

If the user's request is **specific** ("add a faithfulness evaluator", "create a dataset for RAG testing"):
- Focus on the specific evaluation need
- Create the targeted evaluator, dataset, or experiment
- Verify it works in context

## Detect Context

1. Check if you're in a codebase (look for `package.json`, `pyproject.toml`, `requirements.txt`, etc.)
2. If **YES** → use the **Code approach** for experiments (SDK) and guardrails (code integration); use the CLI for evaluators, datasets, and monitors
3. If **NO** → use the **CLI approach** for evaluators, monitors, and datasets (everything platform-side is CLI-driven)
4. If ambiguous → ask the user: "Do you want to write evaluation code or set things up via CLI?"

Some features are code-only (experiments, guardrails) and some are platform-only (monitors). Evaluators work on both surfaces.

## Plan Limits

See [Plan Limits](_shared/plan-limits.md) for how to handle free plan limits gracefully. Focus on delivering value within the limits — create 1-2 high-quality experiments with domain-realistic data rather than many shallow ones. Do NOT try to work around limits by deleting existing resources. Show the user the value of what you created before suggesting an upgrade.

## Prerequisites

Set up the LangWatch CLI first — see [CLI Setup](_shared/cli-setup.md). The CLI is the only interface; it covers documentation (`langwatch docs ...`), evaluator/dataset/monitor CRUD, and evaluation runs.

If you cannot run the `langwatch` CLI at all (e.g. you are inside ChatGPT or another shell-less environment), see [docs fallback](_shared/llms-txt-fallback.md).

Read the evaluations overview first:

```bash
langwatch docs evaluations/overview
```

## Step A: Experiments (Batch Testing) — Code Approach

Create a script or notebook that runs your agent against a dataset and measures quality.

1. Read the SDK docs:
   ```bash
   langwatch docs evaluations/experiments/sdk
   ```
2. Analyze the agent's code to understand what it does
3. Create a dataset with representative examples that are as close to real-world inputs as possible. Focus on domain realism — the dataset should look like actual production data the agent would encounter.
4. Create the experiment file:

**Python — Jupyter Notebook (.ipynb):**
```python
import langwatch
import pandas as pd

# Dataset tailored to the agent's domain
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

**TypeScript — Script (.ts):**
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

5. Run the experiment to verify it works

### Verify by Running

ALWAYS run the experiment after creating it. If it fails, fix it. An experiment that isn't executed is useless.

For Python notebooks: Create an accompanying script to run it:
```python
# run_experiment.py
import subprocess
subprocess.run(["jupyter", "nbconvert", "--to", "notebook", "--execute", "experiment.ipynb"], check=True)
```

Or simply run the cells in order via the notebook interface.

For TypeScript: `npx tsx experiment.ts`

## Step B: Online Evaluation (Production Monitoring & Guardrails)

Online evaluation has two modes:

### Platform mode: Monitors
Set up monitors that continuously score production traffic.

1. Read the docs:
   ```bash
   langwatch docs evaluations/online-evaluation/overview
   ```
2. Create monitors via the CLI:
   ```bash
   langwatch monitor list                                                # See existing monitors
   langwatch monitor create "Toxicity Check" --check-type ragas/toxicity # Create one
   langwatch monitor create "PII Detection" --check-type presidio/pii_detection --sample 0.5
   ```
3. Optionally configure further via the platform UI at https://app.langwatch.ai → Evaluations → Monitors.

### Code mode: Guardrails
Add code to block harmful content before it reaches users (synchronous, real-time).

1. Read the docs:
   ```bash
   langwatch docs evaluations/guardrails/code-integration
   ```
2. Add guardrail checks in your agent code:

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
    # Continue with normal processing...
```

Key distinction: Monitors **measure** (async, observability). Guardrails **act** (sync, enforcement via code with `as_guardrail=True`).

## Step C: Evaluators (Scoring Functions)

Create or configure evaluators — the functions that score your agent's outputs.

### Read the Docs

```bash
langwatch docs evaluations/evaluators/overview
langwatch docs evaluations/evaluators/list      # Browse available evaluators
```

### Code Approach

Use evaluators in experiments via the SDK:
```python
evaluation.evaluate("ragas/faithfulness", index=idx, data={...})
```

### CLI Approach
```bash
langwatch evaluator list                                    # List evaluators
langwatch evaluator create "My Evaluator" --type langevals/llm_judge
langwatch evaluator get <idOrSlug>                          # View details
langwatch evaluator update <idOrSlug> --name "New Name"     # Update
langwatch evaluation run <slug> --wait                      # Run evaluation and wait
langwatch evaluation status <runId>                         # Check run status
```

This is useful for setting up LLM-as-judge evaluators, custom evaluators, or configuring evaluators that will be used in platform experiments and monitors.

## Step D: Datasets

Create test datasets for experiments.

### CLI Approach
```bash
langwatch dataset list                                      # List datasets
langwatch dataset create "My Dataset" -c input:string,output:string
langwatch dataset upload my-dataset data.csv                # Upload CSV/JSON
langwatch dataset records list my-dataset                   # View records
langwatch dataset download my-dataset -f csv                # Download
```

### Read the Docs

```bash
langwatch docs datasets/overview
langwatch docs datasets/programmatic-access     # Programmatic access
langwatch docs datasets/ai-dataset-generation   # AI-generated datasets
```

Generate a dataset tailored to your agent:

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

Then generate data that reflects EXACTLY this agent's real-world usage. For example:
- If the system prompt says "respond in tweet-like format with emojis" → your dataset inputs should be things users would ask this specific bot, and expected outputs should be short emoji-laden responses
- If the agent is a SQL assistant → your dataset should have natural language queries with expected SQL
- If the agent handles refunds → your dataset should have refund scenarios

NEVER use generic examples like "What is 2+2?", "What is the capital of France?", or "Explain quantum computing". These are useless for evaluating the specific agent. Every single example must be something a real user of THIS specific agent would actually say.

---

## Platform Approach: Prompts + Evaluators (No Code)

When the user has no codebase and wants to set up evaluation building blocks on the platform.
Use the CLI:

### Create or Update a Prompt

```bash
langwatch prompt list                             # List existing prompts
langwatch prompt create my-prompt                 # Create a new prompt YAML
langwatch prompt push                             # Push to the platform
langwatch prompt versions my-prompt               # View version history
langwatch prompt tag assign my-prompt production  # Tag a version
```

### Check Model Providers

Before creating evaluators, verify model providers are configured:

```bash
langwatch model-provider list                     # Check existing providers
langwatch model-provider set openai --api-key sk-... # Set up a provider
```

### Create an Evaluator

```bash
langwatch evaluator list                          # See available evaluators
langwatch evaluator create "Quality Judge" --type langevals/llm_judge
langwatch evaluator get <idOrSlug> --format json  # View details
```

### Create a Dataset

```bash
langwatch dataset create "Test Data" -c input:string,expected_output:string
langwatch dataset upload test-data data.csv       # Upload from CSV/JSON/JSONL
langwatch dataset records list test-data           # View records
```

### Set Up Monitors (Online Evaluation)

```bash
langwatch monitor create "Toxicity Check" --check-type ragas/toxicity
langwatch monitor create "PII Detection" --check-type presidio/pii_detection --sample 0.5
langwatch monitor list                            # View all monitors
```

### Test in the Platform

Go to https://app.langwatch.ai and:
1. Navigate to your project's Prompts section
2. Open the prompt you created
3. Use the Prompt Playground to test variations
4. Set up an experiment in the Experiments section using your prompt, evaluator, and dataset

## Common Mistakes

- Do NOT say "run an evaluation" — be specific: experiment, monitor, or guardrail
- Do NOT use generic/placeholder datasets — generate domain-specific examples
- Do NOT skip running the experiment to verify it works
- Monitors **measure** (async), guardrails **act** (sync, via code with `as_guardrail=True`) — both are online evaluation
- Always set up `LANGWATCH_API_KEY` in `.env`
- Always run `langwatch evaluator create --help` first if unsure which `--type` values are valid
