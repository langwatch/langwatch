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
import { setup } from "langwatch/node";
import { getTracer } from "langwatch/observability";

// 1. Initialize LangWatch (Node.js example)
await setup({ apiKey: "YOUR_API_KEY" }); // By default, this will read the LANGWATCH_API_KEY environment variable

// 2. Create a tracer and span
const tracer = getTracer("my-app");
const span = tracer.startSpan("my-operation");
span.setInput("User prompt");
span.setOutput("Model response");
span.end();
```

> **Tip:** For use in the browser, use `import { setup } from "langwatch/browser"` instead.

---

## Quick Start: Core Features

### 1. Tracing & Observability

- **Get a tracer:**
  ```ts
  const tracer = getTracer("my-app");
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
  ```
  > **Advanced:** The `addGenAI...` methods are optional and mainly for advanced/manual instrumentation. Most users do not need these unless you want fine-grained message event logs.

- **RAG context, metrics, and evaluation:**
  ```ts
  span.setRAGContexts([{ document_id: "doc1", chunk_id: "c1", content: "..." }]);
  span.setMetrics({ promptTokens: 10, completionTokens: 20, cost: 0.002 });
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

---

## API Reference

### Observability
- `getLangWatchTracer(name, version?)` → `LangWatchTracer`
- `LangWatchSpan` methods: `.setType()`, `.setInput()`, `.setOutput()`, `.recordEvaluation()`, `.addGenAISystemMessageEvent()`, `.addGenAIUserMessageEvent()`, `.addGenAIAssistantMessageEvent()`, `.addGenAIToolMessageEvent()`, `.setRAGContexts()`, `.setMetrics()`, etc.

### Prompt
- `getPrompt(promptId, variables?)` → fetches and formats a prompt (creates a span automatically)
- `getPromptVersion(promptId, versionId, variables?)`

### Evaluation
- `runEvaluation(details)` → runs an evaluation and returns result (creates a span automatically)
- `recordEvaluation(details, attributes?)` → records a custom evaluation span (creates a span automatically)

### Utilities
- `convertFromVercelAIMessages(messages)`
- `captureError(error)`
- `autoconvertTypedValues(value)`

---

## Types
- `PromptDefinition`, `PromptMessage`, `PromptConfig`, `EvaluationDetails`, `SingleEvaluationResult`, `LangWatchSpan`, etc.

---

## Advanced
- Custom OpenTelemetry exporters: see `src/observability/exporters`
- Instrumentation helpers: see `src/observability/instrumentation`
- Full TypeScript types for all APIs

---

## Community & Support

- [LangWatch Website](https://langwatch.ai)
- [Documentation](https://docs.langwatch.ai)
- [GitHub Issues](https://github.com/langwatch/langwatch/issues)
- [Discord Community](https://discord.gg/langwatch)

---

## License

This project is licensed under the MIT License - see the [LICENSE](./LICENSE) file for details.
