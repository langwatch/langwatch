# LangWatch Evaluation Examples

This directory contains examples demonstrating how to run batch evaluations using the LangWatch TypeScript SDK.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a `.env` file with your credentials:

```bash
# Get your API key from https://app.langwatch.ai
LANGWATCH_API_KEY=your_api_key_here

# Optional: Point to local LangWatch instance
LANGWATCH_ENDPOINT=http://localhost:5560

# For examples using OpenAI (optional)
OPENAI_API_KEY=your_openai_key_here
```

## Examples

### Basic Evaluation

A simple example showing how to run evaluations with custom metrics:

```bash
npm start
```

This example:
- Iterates over a Q&A dataset
- Calls a simulated LLM for each question
- Logs accuracy (pass/fail) and confidence score metrics

### With Built-in Evaluators

Shows how to use LangWatch's built-in evaluators (like `exact_match`):

```bash
npm run start:with-evaluator
```

This example:
- Uses the `langevals/exact_match` evaluator
- Combines built-in evaluators with custom metrics

### Multi-Target Comparison

Demonstrates comparing different models/configurations:

```bash
npm run start:multi-target
```

This example:
- Compares GPT-4, GPT-3.5, and Claude responses
- Uses the `target` and `metadata` parameters
- Results show comparison charts in the LangWatch UI

## Key Concepts

### Initializing an Evaluation

```typescript
const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT,
});

const evaluation = await langwatch.evaluation.init("my-experiment-name");
```

### Running Over a Dataset

```typescript
await evaluation.run(
  dataset,
  async ({ item, index }) => {
    // Your evaluation logic here
    const response = await myLLM(item.question);
    
    evaluation.log("accuracy", {
      index,
      passed: response === item.expected,
    });
  },
  { concurrency: 4 } // Run 4 items in parallel
);
```

### Logging Metrics

```typescript
// Boolean pass/fail
evaluation.log("accuracy", { index, passed: true });

// Numeric score
evaluation.log("latency", { index, score: 150.5 });

// With target for comparison
evaluation.log("accuracy", {
  index,
  passed: true,
  target: "gpt-4",
  metadata: { model: "openai/gpt-4" },
});

// With additional data
evaluation.log("response", {
  index,
  score: 0.95,
  data: { input: "...", output: "..." },
});
```

### Using Built-in Evaluators

```typescript
await evaluation.evaluate("langevals/exact_match", {
  index,
  data: {
    output: response,
    expected_output: expected,
  },
});
```
