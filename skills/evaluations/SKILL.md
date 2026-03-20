---
name: evaluations
user-prompt: "Set up evaluations for my agent"
description: Set up comprehensive evaluations for your AI agent with LangWatch — experiments (batch testing), evaluators (scoring functions), datasets, online evaluation (production monitoring), and guardrails (real-time blocking). Supports both code (SDK) and platform (MCP) approaches. Use when the user wants to evaluate, test, benchmark, monitor, or safeguard their agent.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code, Claude Web, and similar AI assistants.
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
2. If **YES** → use the **Code approach** for experiments (SDK) and guardrails (code integration)
3. If **NO** → use the **Platform approach** for evaluators (MCP tools) and monitors (UI guidance)
4. If ambiguous → ask the user: "Do you want to write evaluation code or set things up on the platform?"

Some features are code-only (experiments, guardrails) and some are platform-only (monitors). Evaluators work on both surfaces.

## Plan Limits

See [Plan Limits](_shared/plan-limits.md) for how to handle free plan limits gracefully. Focus on delivering value within the limits — create 1-2 high-quality experiments with domain-realistic data rather than many shallow ones. Do NOT try to work around limits by deleting existing resources. Show the user the value of what you created before suggesting an upgrade.

## Prerequisites

Set up the LangWatch MCP for documentation access:

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md).

Read the evaluations overview first: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/overview.md`

## Step A: Experiments (Batch Testing) — Code Approach

Create a script or notebook that runs your agent against a dataset and measures quality.

1. Read the SDK docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/experiments/sdk.md`
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

1. Read the docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/online-evaluation/overview.md`
2. Configure via the platform UI:
   - Go to https://app.langwatch.ai → Evaluations → Monitors
   - Create a new monitor with "When a message arrives" trigger
   - Select evaluators (e.g., PII Detection, Faithfulness)
   - Enable monitoring

### Code mode: Guardrails
Add code to block harmful content before it reaches users (synchronous, real-time).

1. Read the docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/guardrails/code-integration.md`
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

### Code Approach
1. Read the docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/evaluators/overview.md`
2. Browse available evaluators: `https://langwatch.ai/docs/evaluations/evaluators/list.md`
3. Use evaluators in experiments via the SDK:
   ```python
   evaluation.evaluate("ragas/faithfulness", index=idx, data={...})
   ```

### Platform Approach
1. Call `discover_schema` with category "evaluators" to see available types
2. Use `platform_create_evaluator` to create an evaluator on the platform
3. Use `platform_list_evaluators` to see existing evaluators
4. Use `platform_get_evaluator` and `platform_update_evaluator` to review and modify

This is useful for setting up LLM-as-judge evaluators, custom evaluators, or configuring evaluators that will be used in platform experiments and monitors.

## Step D: Datasets

Create test datasets for experiments.

1. Read the docs: call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/datasets/overview.md`
2. Generate a dataset tailored to your agent:

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

3. For programmatic dataset access: `https://langwatch.ai/docs/datasets/programmatic-access.md`
4. For AI-generated datasets: `https://langwatch.ai/docs/datasets/ai-dataset-generation.md`

---

## Platform Approach: Prompts + Evaluators (No Code)

When the user has no codebase and wants to set up evaluation building blocks on the platform:

NOTE: Full UI experiments and dataset creation are not yet available via MCP. This approach sets up the building blocks (prompts + evaluators) that can then be used in the platform UI.

### Create or Update a Prompt

Use the `platform_create_prompt` MCP tool to create a new prompt:
- Provide a name, model, and messages (system + user)
- The prompt will appear in your LangWatch project's Prompts section

Or use `platform_list_prompts` to find existing prompts and `platform_update_prompt` to modify them.

### Check Model Providers

Before creating evaluators on the platform, verify model providers are configured:

1. Call `platform_list_model_providers` to check existing providers
2. If no providers are configured, ask the user if they have an LLM API key (OpenAI, Anthropic, etc.)
3. If they do, set it up with `platform_set_model_provider` so evaluators can run

### Create an Evaluator

Use the `platform_create_evaluator` MCP tool to set up evaluation criteria:
- First call `discover_schema` with category "evaluators" to see available evaluator types
- Create an LLM-as-judge evaluator for quality assessment
- Or create a specific evaluator type matching your use case

### Test in the Platform

Go to https://app.langwatch.ai and:
1. Navigate to your project's Prompts section
2. Open the prompt you created
3. Use the Prompt Playground to test variations
4. Set up an experiment in the Experiments section using your prompt and evaluator

### Current Limitations

- UI experiments cannot be created via MCP yet — use the platform UI
- Datasets cannot be created via MCP yet — use the platform UI or SDK
- The MCP can create prompts and evaluators, which are the building blocks for experiments

## Common Mistakes

- Do NOT say "run an evaluation" — be specific: experiment, monitor, or guardrail
- Do NOT use generic/placeholder datasets — generate domain-specific examples
- Do NOT use `platform_` MCP tools for code-based features (experiments, guardrails) — write code
- Do use `platform_` MCP tools for platform-based features (evaluators, monitors) when the user wants no-code
- Do NOT skip running the experiment to verify it works
- Monitors **measure** (async), guardrails **act** (sync, via code with `as_guardrail=True`) — both are online evaluation
- Always set up `LANGWATCH_API_KEY` in `.env`
- Always call `discover_schema` before creating evaluators via MCP to understand available types
- Do NOT create prompts with `langwatch prompt create` CLI when using the platform approach — that's for code-based projects
