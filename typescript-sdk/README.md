# LangWatch TypeScript SDK

<p align="center">
  <img src="https://app.langwatch.ai/logo.svg" alt="LangWatch Logo" width="120"/>
</p>

<p align="center">
  <b>Observability, Prompt Management, and Evaluation for JS LLM/GenAI Apps</b><br/>
  <a href="https://langwatch.ai">langwatch.ai</a> &nbsp;|&nbsp; <a href="https://github.com/langwatch/langwatch">GitHub</a>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/langwatch"><img src="https://img.shields.io/npm/v/langwatch.svg?style=flat-square" alt="npm version"></a>
  <a href="https://opensource.org/licenses/Apache-2.0"><img src="https://img.shields.io/badge/license-Apache--2.0-blue.svg?style=flat-square" alt="License"></a>
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
import { setupLangWatch } from "langwatch/node";
import { getLangWatchTracer } from "langwatch";

// 1. Initialize LangWatch (Node.js example)
await setupLangWatch({ apiKey: "YOUR_API_KEY" }); // By default, this will read the LANGWATCH_API_KEY environment variable

// 2. Create a tracer and span
const tracer = getLangWatchTracer("my-app");
const span = tracer.startSpan("my-operation");
span.setInput("User prompt");
span.setOutput("Model response");
span.end();
```

> **Tip:** For use in the browser, use `import { setupLangWatch } from "langwatch/browser"` instead.

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

---

## API Reference

### Setup
- `setupLangWatch(options?)` → Initialize LangWatch (from `langwatch/node` or `langwatch/browser`)

### Observability
- `getLangWatchTracer(name, version?)` → `LangWatchTracer`
- `LangWatchTracer` methods: `.startSpan()`, `.startActiveSpan()`, `.withActiveSpan()`
- `LangWatchSpan` methods:
  - `.setType()`, `.setInput()`, `.setOutput()`, `.setInputString()`, `.setOutputString()`
  - `.recordEvaluation()`, `.setRequestModel()`, `.setResponseModel()`
  - `.setRAGContexts()`, `.setRAGContext()`, `.setMetrics()`, `.setSelectedPrompt()`
  - `.addGenAISystemMessageEvent()`, `.addGenAIUserMessageEvent()`, `.addGenAIAssistantMessageEvent()`, `.addGenAIToolMessageEvent()`, `.addGenAIChoiceEvent()`

### Prompt
- `getPrompt(promptId, variables?)` → fetches and formats a prompt (creates a span automatically)
- `getPromptVersion(promptId, versionId, variables?)` → fetches specific prompt version

### Evaluation
- `runEvaluation(details)` → runs an evaluation and returns result (creates a span automatically)
- `recordEvaluation(details, attributes?)` → records a custom evaluation span (creates a span automatically)

### LangChain Integration
- `LangWatchCallbackHandler` → LangChain callback handler for automatic instrumentation

### Exporters & Processors
- `LangWatchExporter` → Custom OpenTelemetry exporter
- `FilterableBatchSpanProcessor` → Span processor with filtering capabilities

---

## Types

### Core Types
- `LangWatchSpan` → Extended OpenTelemetry span with LangWatch methods
- `LangWatchTracer` → Extended OpenTelemetry tracer with LangWatch methods
- `SpanType` → Union of supported span types (`"llm"`, `"chain"`, `"tool"`, `"agent"`, etc.)

### Evaluation Types
- `EvaluationDetails` → Configuration for running evaluations
- `SingleEvaluationResult` → Result from evaluation runs
- `RecordedEvaluationDetails` → Configuration for recording custom evaluations

### Prompt Types
- `Prompt` → Prompt object with compilation capabilities
- `CompiledPrompt` → Compiled prompt with variables interpolated
- `TemplateVariables` → Variables for prompt compilation

### RAG & Metrics Types
- `LangWatchSpanRAGContext` → RAG context structure
- `LangWatchSpanMetrics` → Metrics structure (tokens, cost)
- `LangWatchSpanGenAI*EventBody` → GenAI message event structures

---

## Advanced

### Custom OpenTelemetry Integration
```ts
import { FilterableBatchSpanProcessor, LangWatchExporter } from "langwatch";

const processor = new FilterableBatchSpanProcessor(
  new LangWatchExporter(apiKey, endpoint),
  excludeRules
);
```

### Span Processing Rules
```ts
const excludeRules: SpanProcessingExcludeRule[] = [
  { attribute: "http.url", value: "/health" },
  { attribute: "span.type", value: "health" }
];
```

### Manual Instrumentation
```ts
import { semconv } from "langwatch/observability";

span.setAttributes({
  [semconv.ATTR_LANGWATCH_THREAD_ID]: threadId,
});
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
