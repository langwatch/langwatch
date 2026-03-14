---
name: experiment
description: Create an evaluation experiment for your AI agent. Generates a Jupyter notebook (Python) or script (TypeScript) with a dataset tailored to your agent, evaluators, and LangWatch experiment tracking. Use when the user wants to benchmark, evaluate, or compare their agent's performance.
license: MIT
compatibility: Requires Node.js for MCP setup. Works with Claude Code and similar coding agents.
---

# Create an Evaluation Experiment

This skill creates a **batch evaluation experiment** — a script or notebook that runs your agent against a dataset and measures quality with evaluators. This is NOT scenario/simulation testing (which uses `@langwatch/scenario`). An experiment uses `langwatch.experiment.init()` to track metrics across many examples.

The output is a `.py` script or `.ipynb` notebook that imports `langwatch` and uses the `langwatch.experiment` API.

## Step 1: Set up the LangWatch MCP

First, install the LangWatch MCP server so you have access to the experiments SDK documentation:

See [MCP Setup](_shared/mcp-setup.md) for installation instructions.

If MCP installation fails, see [docs fallback](_shared/llms-txt-fallback.md) to fetch docs directly via URLs.

## Step 2: Read the Experiments SDK Docs

Use the LangWatch MCP to fetch the experiments SDK documentation:

- Call `fetch_langwatch_docs` with url `https://langwatch.ai/docs/evaluations/experiments/sdk.md`
- Read the full page to understand `experiment.init()`, `evaluation.loop()`, `evaluation.log()`, and `evaluation.evaluate()`

CRITICAL: Do NOT guess the experiment API. Read the actual documentation first.

## Step 3: Analyze the User's Agent Code

Before writing anything, study the user's codebase to understand:

- What the agent does (chatbot, RAG pipeline, classifier, code assistant, etc.)
- What inputs it takes and what outputs it produces
- What framework it uses (OpenAI, LangChain, LangGraph, Vercel AI, etc.)
- What language it's written in (Python or TypeScript)

This analysis determines what dataset to generate and what evaluators to use.

## Step 4: Generate a Tailored Dataset

Create a dataset of 10-20 representative examples that match the agent's actual domain. Look at the agent's code to decide:

- **Chatbot** (general assistant) -> Generate realistic user questions and conversation starters relevant to the bot's persona or topic
- **RAG pipeline** -> Generate questions with expected answers that test retrieval and generation quality
- **Classifier** -> Generate inputs with expected category labels
- **Code assistant** -> Generate coding tasks with expected outputs
- **Customer support bot** -> Generate support tickets or customer questions
- **Summarizer** -> Generate documents with expected summaries

CRITICAL: The dataset must be specific to what the agent ACTUALLY does. Do NOT use generic examples like "What is 2+2?" or "Hello, how are you?". Study the system prompt, the function signatures, and any domain context in the code.

## Step 5: Create the Experiment File

### Python: Create a Jupyter Notebook (.ipynb)

Create a notebook with these cells:

1. **Setup cell**: Install dependencies (`pip install langwatch pandas openai`)
2. **Import cell**: Import langwatch, pandas, and the user's agent
3. **Dataset cell**: Define the tailored dataset as a pandas DataFrame
4. **Experiment cell**: Initialize the experiment with `langwatch.experiment.init("experiment-name")`
5. **Evaluation loop cell**: Iterate with `evaluation.loop()`, call the agent, log metrics
6. **Evaluator cell**: Include at least one evaluator (LLM-as-judge for response quality is a good default)

```python
import langwatch
import pandas as pd

# Dataset tailored to the agent's domain
data = {
    "input": [
        # 10-20 domain-specific examples here
    ],
    "expected_output": [
        # Expected outputs or criteria
    ],
}
df = pd.DataFrame(data)

evaluation = langwatch.experiment.init("agent-evaluation")

for index, row in evaluation.loop(df.iterrows()):
    response = my_agent(row["input"])

    evaluation.evaluate(
        "llm/quality",
        index=index,
        data={
            "input": row["input"],
            "output": response,
        },
        settings={
            "model": "openai/gpt-4.1-mini",
            "max_tokens": 2048,
        },
    )
```

### TypeScript: Create a Script (.ts)

```typescript
import { LangWatch } from "langwatch";

const langwatch = new LangWatch();

// Dataset tailored to the agent's domain
const dataset = [
  // 10-20 domain-specific examples here
  { input: "...", expectedOutput: "..." },
];

const evaluation = await langwatch.experiments.init("agent-evaluation");

await evaluation.run(dataset, async ({ item, index }) => {
  const response = await myAgent(item.input);

  await evaluation.evaluate("llm/quality", {
    index,
    data: {
      input: item.input,
      output: response,
    },
    settings: {
      model: "openai/gpt-4.1-mini",
      max_tokens: 2048,
    },
  });
});
```

## Step 6: Set Up the API Key

Add `LANGWATCH_API_KEY` to the project's `.env` file if not already present:

```
LANGWATCH_API_KEY=your-api-key-here
```

See [API Key Setup](_shared/api-key-setup.md).

## Step 7: Verify the Experiment

Run the experiment to confirm it works:

- **Python notebook**: Execute all cells in order
- **TypeScript script**: Run with `npx tsx experiment.ts` or equivalent

Check that:
- The experiment initializes without errors
- The agent is called for each dataset entry
- Metrics are logged successfully

## Common Mistakes

- Do NOT use generic/placeholder datasets -- generate domain-specific examples based on the agent's actual code
- Do NOT use `platform_` MCP tools -- this skill writes code, not platform resources
- Do NOT skip running the experiment to verify it works
- Do NOT guess the LangWatch experiment API -- read the docs via MCP first
- Always set up `LANGWATCH_API_KEY` in `.env`
- Do NOT hardcode the API key in the experiment file -- use environment variables
