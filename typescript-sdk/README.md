# LangWatch TypeScript SDK

<p align="center">
  <img src="https://github.com/langwatch/langwatch/blob/main/assets/logo-header.webp?raw=true" alt="LangWatch Logo" />
</p>

<p align="center">
  <b>Observability, Prompt Management, and Evaluation for JS LLM/GenAI Apps</b><br/>
  <a href="https://langwatch.ai">langwatch.ai</a> &nbsp;|&nbsp; <a href="https://github.com/langwatch/langwatch">GitHub</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/langwatch"><img src="https://img.shields.io/npm/v/langwatch.svg?style=flat-square" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square" alt="License"></a>
</p>

---

LangWatch helps you monitor, debug, and optimize your LLM/GenAI applications. This TypeScript SDK provides:

- **OpenTelemetry-based tracing** for LLM, RAG, tool, and workflow spans
- **Prompt management** with versioning and variable interpolation
- **Automated and custom evaluation** of model outputs

---

## Features

- 📊 **Observability**: Trace LLM, RAG, tool, and workflow operations with rich context
- 📝 **Prompt Management**: Fetch, version, and interpolate prompts with variables
- 🧪 **Evaluation**: Run and record evaluations, with results linked to traces
- 🔌 **OpenTelemetry**: Integrates with your existing observability stack
- 🦾 **TypeScript-first**: Full type safety and modern API design

---

## Installation

```bash
npm install langwatch
```

---

## 🚀 Getting Started

Here's the fastest way to get LangWatch working in your app:

```ts
import { setupObservability } from "langwatch/observability/node";
import { getLangWatchTracer } from "langwatch";

// 1. Initialize LangWatch (Node.js example)
await setupObservability(); // By default this will read the LANGWATCH_API_KEY environment variable to set the API key.

// 2. Create a tracer and span
const tracer = getLangWatchTracer("my-app");
const span = tracer.startSpan("my-operation");
span.setInput("User prompt");
span.setOutput("Model response");
span.end();
```

> **Tip:** For use in the browser, use `import { setupObservability } from "langwatch/browser"` instead.

---

## Quick Start: Core Features

### 1. Tracing & Observability

- **Get a tracer:**
  ```ts
  const tracer = getLangWatchTracer("my-app");
  ```
- **Start a span and record input/output:**
  ```ts
  const span = tracer.startSpan("call-llm");
  span.setType("llm");
  span.setInput("User prompt"); // Main way to record input
  span.setOutput("Model response"); // Main way to record output
  span.end();
  ```
  > **Note:** `setInput` and `setOutput` are the primary methods to record input/output. Use `setInputString`/`setOutputString` for plain text, or pass any serializable value.

- **Use withActiveSpan for automatic error handling:**
  ```ts
  await tracer.withActiveSpan("my-operation", async (span) => {
    span.setType("llm");
    span.setInput("User prompt");
    // ... your code ...
    span.setOutput("Model response");
  });
  ```

- **Record an evaluation directly on a span:**
  ```ts
  span.recordEvaluation({ name: "My Eval", passed: true, score: 1.0 });
  ```
  > **Note:** This associates evaluation results with a specific span (operation or model call).

- **(Optional) Add GenAI message events:**
  ```ts
  span.addGenAISystemMessageEvent({ content: "You are a helpful assistant." });
  span.addGenAIUserMessageEvent({ content: "Hello!" });
  span.addGenAIAssistantMessageEvent({ content: "Hi! How can I help you?" });
  span.addGenAIToolMessageEvent({ content: "Tool result", id: "tool-1" });
  span.addGenAIChoiceEvent({ finish_reason: "stop", index: 0, message: { content: "Response" } });
  ```
  > **Advanced:** The `addGenAI...` methods are optional and mainly for advanced/manual instrumentation. Most users do not need these unless you want fine-grained message event logs.

- **RAG context, metrics, and model information:**
  ```ts
  span.setRAGContexts([{ document_id: "doc1", chunk_id: "c1", content: "..." }]);
  span.setMetrics({ promptTokens: 10, completionTokens: 20, cost: 0.002 });
  span.setRequestModel("gpt-4");
  span.setResponseModel("gpt-4");
  ```

### 2. Prompt Management

- **Fetch and format a prompt:**
  ```ts
  import { getPrompt } from "langwatch/prompt";
  const prompt = await getPrompt("prompt-id");
  const compiledPrompt = await getPrompt("prompt-id", { user: "Alice" });
  ```
- **Fetch a specific prompt version:**
  ```ts
  import { getPromptVersion } from "langwatch/prompt";
  const compiledPrompt = await getPromptVersion("prompt-id", "version-id", {
    user: "Alice",
  });
  ```

  > **Note:** The prompt APIs (`getPrompt`, `getPromptVersion`) automatically create spans and add useful tracing information.

### 3. Evaluation

- **Run an evaluation:**
  ```ts
  import { runEvaluation } from "langwatch/evaluation";
  const result = await runEvaluation({
    slug: "helpfulness",
    data: { input: "Hi", output: "Hello!" }
  });
  ```
- **Record a custom evaluation:**
  ```ts
  import { recordEvaluation } from "langwatch/evaluation";
  recordEvaluation({
    name: "Manual Eval",
    passed: true,
    score: 0.9,
    details: "Looks good!"
  });
  ```
  > **Note:** The evaluation APIs (`runEvaluation`, `recordEvaluation`) also create spans and add tracing/evaluation info automatically.

### 4. LangChain Integration

- **Use with LangChain:**
  ```ts
  import { LangWatchCallbackHandler } from "langwatch/observability/instrumentation/langchain";

  const chatModel = new ChatOpenAI({
    callbacks: [new LangWatchCallbackHandler()],
  });
  ```

## Advanced

### Filtering Spans

Control which spans are sent to LangWatch using the built-in filter DSL. By default, HTTP request spans are excluded to reduce framework noise.

#### Using Presets

```ts
import { LangWatchTraceExporter } from "langwatch";

// Keep only Vercel AI SDK spans
const exporter = new LangWatchTraceExporter({
  filters: [{ preset: "vercelAIOnly" }],
});

// No filtering (send all spans)
const exporter = new LangWatchTraceExporter({
  filters: null, // or filters: []
});
```

#### Custom Filters

```ts
// Include only specific scopes
const exporter = new LangWatchTraceExporter({
  filters: [
    { include: { instrumentationScopeName: [{ equals: "ai" }] } },
  ],
});

// Exclude spans by name pattern
const exporter = new LangWatchTraceExporter({
  filters: [
    { exclude: { name: [{ startsWith: "internal." }] } },
  ],
});

// Combine filters (AND pipeline)
const exporter = new LangWatchTraceExporter({
  filters: [
    { include: { instrumentationScopeName: [{ equals: "ai" }] } },
    { preset: "excludeHttpRequests" },
  ],
});
```

**Learn more:** See the [Filtering Spans Tutorial](https://docs.langwatch.ai/integration/typescript/tutorials/filtering-spans) for comprehensive examples and best practices.

### Custom OpenTelemetry Integration
```ts
import { FilterableBatchSpanProcessor, LangWatchExporter } from "langwatch";

const processor = new FilterableBatchSpanProcessor(
  new LangWatchExporter({
    apiKey: "your-api-key",
    endpoint: "https://custom.langwatch.com",
  }),
  excludeRules
);
```

### Span Processing Rules
```ts
const excludeRules: SpanProcessingExcludeRule[] = [
  { attribute: "http.url", value: "/health" },
  { attribute: "span.type", value: "health" },
];
```

### Manual Instrumentation
```ts
import { semconv } from "langwatch/observability";

span.setAttributes({
  [semconv.ATTR_LANGWATCH_THREAD_ID]: threadId,
});
```

## Testing

## Unit and Integration Testing

This will run the unit and integration tests. You will need to make sure the values in the `.env` file are set correctly, but you can omit the `E2E_` prefixed variables for these tests.

```bash
pnpm test
```

## E2E Testing

For E2E tests, you will need to set the `E2E_` prefixed variables in the `.env` file. You will also need to have run build before.

```bash
pnpm build
pnpm test:e2e
```

---

## Community & Support

- [LangWatch Website](https://langwatch.ai)
- [Documentation](https://docs.langwatch.ai)
- [GitHub Issues](https://github.com/langwatch/langwatch/issues)
- [Discord Community](https://discord.gg/langwatch)

---

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
