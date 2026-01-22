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

Demonstrates comparing different models/configurations using `withTarget()`:

```bash
npm run start:multi-target
```

This example:
- Uses `setupObservability()` to enable trace capture (required for trace links)
- Uses `withTarget()` for target-scoped tracing
- Each target gets its own unique trace ID (clickable in evaluation results)
- Automatically captures latency from span timing
- Runs all targets in parallel with `Promise.all`
- Context inference means `log()` calls don't need explicit target
- Results show comparison charts in the LangWatch UI

## Key Concepts

### Setting Up Tracing (Required for Trace Links)

To enable trace capture (so you can click through to trace details from evaluation results):

```typescript
import { setupObservability } from "langwatch/observability/node";

// Call this once at startup
await setupObservability({
  langwatch: {
    apiKey: process.env.LANGWATCH_API_KEY,
    endpoint: process.env.LANGWATCH_ENDPOINT,
  },
});
```

Without `setupObservability()`, evaluations still work but trace links won't be available.

### Initializing an Evaluation

```typescript
const langwatch = new LangWatch({
  apiKey: process.env.LANGWATCH_API_KEY,
  endpoint: process.env.LANGWATCH_ENDPOINT,
});

const evaluation = await langwatch.experiments.init("my-experiment-name");
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

// With target for comparison (explicit)
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

### Using withTarget() for Multi-Target Comparison

The `withTarget()` method creates a target-scoped span with automatic latency capture:

```typescript
await evaluation.run(dataset, async ({ item, index }) => {
  // Run multiple targets in parallel
  const [gpt4, claude] = await Promise.all([
    evaluation.withTarget("gpt-4", { model: "openai/gpt-4" }, async () => {
      const response = await openai.chat(item.question);

      // Target and index are auto-inferred inside withTarget()!
      evaluation.log("quality", { score: 0.95 });

      return response;
    }),

    evaluation.withTarget("claude-3", { model: "anthropic/claude-3" }, async () => {
      const response = await anthropic.messages(item.question);
      evaluation.log("quality", { score: 0.85 });
      return response;
    }),
  ]);

  // Latency is automatically captured from span duration
  console.log(`GPT-4: ${gpt4.duration}ms, Claude: ${claude.duration}ms`);
});
```

Benefits of `withTarget()`:
- **Automatic latency capture** - Duration stored in dataset entry per target (like Evaluations V3)
- **Context inference** - `log()` calls inside automatically use the target
- **Parallel execution** - Use `Promise.all` for concurrent target testing
- **Isolated tracing** - Each target gets its own span and dataset entry

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
