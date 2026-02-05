/**
 * OTEL-Native Trace Generator
 *
 * Generates traces directly using the LangWatch OTEL SDK, eliminating
 * the need for intermediate CollectorRESTParams representation.
 */

import { getLangWatchTracer, type LangWatchSpan } from "langwatch/observability";
import {
  ATTR_GEN_AI_SYSTEM,
  ATTR_GEN_AI_USAGE_PROMPT_TOKENS,
  ATTR_GEN_AI_USAGE_COMPLETION_TOKENS,
} from "@opentelemetry/semantic-conventions/incubating";
import { SpanStatusCode } from "@opentelemetry/api";
import { nanoid } from "nanoid";

type Tracer = ReturnType<typeof getLangWatchTracer>;

// Models to use in test data
const LLM_MODELS = [
  "gpt-4",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "claude-3-opus",
  "claude-3-sonnet",
];

const LABELS = [
  "production",
  "staging",
  "test",
  "chatbot",
  "search",
  "support",
];

const EVALUATION_NAMES = [
  "relevance_check",
  "toxicity_filter",
  "hallucination_detector",
  "accuracy_score",
];

export interface TraceVariationResult {
  name: string;
  description: string;
  count: number;
}

export interface GenerationResult {
  variations: TraceVariationResult[];
  totalTraces: number;
  timeRange: { startDate: number; endDate: number };
}

/**
 * Create a unique run prefix for trace identification
 */
export function createRunPrefix(): string {
  return `parity-${nanoid(8)}`;
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate LLM traces directly with OTEL SDK
 * Uses real-time timestamps for accurate duration tracking
 */
async function generateLLMTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const model = LLM_MODELS[i % LLM_MODELS.length]!;
    const vendor = model.startsWith("gpt") ? "openai" : "anthropic";
    const promptTokens = 100 + Math.floor(Math.random() * 400);
    const completionTokens = 50 + Math.floor(Math.random() * 200);
    const cost = promptTokens * 0.00003 + completionTokens * 0.00006;

    await tracer.withActiveSpan(`${model} completion`, async (span) => {
      span.setType("llm");
      // Set run prefix for trace isolation
      span.setAttribute("run.prefix", runPrefix);
      span.setInput("chat_messages", [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Test message ${i}` },
      ]);
      span.setOutput("chat_messages", [
        { role: "assistant", content: `Response to test message ${i}` },
      ]);
      span.setRequestModel(model);
      span.setResponseModel(model);
      span.setAttribute(ATTR_GEN_AI_SYSTEM, vendor);
      // Set GenAI semconv token attributes directly for ClickHouse compatibility
      span.setAttribute(ATTR_GEN_AI_USAGE_PROMPT_TOKENS, promptTokens);
      span.setAttribute(ATTR_GEN_AI_USAGE_COMPLETION_TOKENS, completionTokens);
      span.setMetrics({
        promptTokens,
        completionTokens,
        cost,
      });

      // Set metadata on root span
      span.setAttribute("langwatch.user.id", `user-${(i % 10) + 1}`);
      span.setAttribute("langwatch.thread.id", `thread-${(i % 5) + 1}`);
      span.setAttribute("metadata", JSON.stringify({ labels: [LABELS[i % LABELS.length]!] }));

      // Small delay to simulate processing
      await sleep(50 + Math.floor(Math.random() * 100));
    });
  }
}

/**
 * Generate RAG traces with nested spans
 */
async function generateRAGTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const model = LLM_MODELS[i % LLM_MODELS.length]!;
    const vendor = model.startsWith("gpt") ? "openai" : "anthropic";

    await tracer.withActiveSpan("main_chain", async (rootSpan) => {
      rootSpan.setType("chain");
      // Set run prefix for trace isolation
      rootSpan.setAttribute("run.prefix", runPrefix);
      rootSpan.setInput("text", `Input for chain ${i}`);

      // Set metadata on root span
      rootSpan.setAttribute("langwatch.user.id", `user-${(i % 8) + 1}`);
      rootSpan.setAttribute("langwatch.thread.id", `thread-rag-${(i % 3) + 1}`);
      rootSpan.setAttribute("metadata", JSON.stringify({ labels: ["rag", LABELS[i % LABELS.length]!] }));

      // Nested RAG retrieval span
      await tracer.withActiveSpan("document retrieval", async (ragSpan) => {
        ragSpan.setType("rag");
        ragSpan.setInput("text", `Search query ${i}`);
        ragSpan.setOutput("json", { retrieved_count: 3 });
        ragSpan.setRAGContexts([
          {
            document_id: `doc-${(i % 5) + 1}`,
            chunk_id: `chunk-${i}-1`,
            content: `Document content for query ${i}, chunk 1`,
          },
          {
            document_id: `doc-${((i + 1) % 5) + 1}`,
            chunk_id: `chunk-${i}-2`,
            content: `Document content for query ${i}, chunk 2`,
          },
          {
            document_id: `doc-${((i + 2) % 5) + 1}`,
            chunk_id: `chunk-${i}-3`,
            content: `Document content for query ${i}, chunk 3`,
          },
        ]);
        await sleep(30 + Math.floor(Math.random() * 50));
      });

      // Nested LLM span
      const promptTokens = 100 + Math.floor(Math.random() * 400);
      const completionTokens = 50 + Math.floor(Math.random() * 200);
      const cost = promptTokens * 0.00003 + completionTokens * 0.00006;

      await tracer.withActiveSpan(`${model} completion`, async (llmSpan) => {
        llmSpan.setType("llm");
        llmSpan.setInput("chat_messages", [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: `Test message ${i}` },
        ]);
        llmSpan.setOutput("chat_messages", [
          { role: "assistant", content: `Response to test message ${i}` },
        ]);
        llmSpan.setRequestModel(model);
        llmSpan.setResponseModel(model);
        llmSpan.setAttribute(ATTR_GEN_AI_SYSTEM, vendor);
        // Set GenAI semconv token attributes directly for ClickHouse compatibility
        llmSpan.setAttribute(ATTR_GEN_AI_USAGE_PROMPT_TOKENS, promptTokens);
        llmSpan.setAttribute(ATTR_GEN_AI_USAGE_COMPLETION_TOKENS, completionTokens);
        llmSpan.setMetrics({ promptTokens, completionTokens, cost });
        await sleep(50 + Math.floor(Math.random() * 100));
      });

      rootSpan.setOutput("text", `Output from chain ${i}`);
      await sleep(10);
    });
  }
}

/**
 * Generate chain/tool traces with multiple nested tool spans
 */
async function generateChainToolTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const model = LLM_MODELS[i % LLM_MODELS.length]!;
    const vendor = model.startsWith("gpt") ? "openai" : "anthropic";
    const numTools = 2 + (i % 3);

    await tracer.withActiveSpan("main_chain", async (rootSpan) => {
      rootSpan.setType("chain");
      // Set run prefix for trace isolation
      rootSpan.setAttribute("run.prefix", runPrefix);
      rootSpan.setInput("text", `Input for chain ${i}`);

      // Set metadata
      rootSpan.setAttribute("langwatch.user.id", `user-${(i % 6) + 1}`);
      rootSpan.setAttribute("langwatch.customer.id", `customer-${(i % 4) + 1}`);
      rootSpan.setAttribute("metadata", JSON.stringify({ labels: ["agent", LABELS[i % LABELS.length]!] }));

      // Create nested tool spans
      for (let j = 0; j < numTools; j++) {
        await tracer.withActiveSpan(`tool_${j}`, async (toolSpan) => {
          toolSpan.setType("tool");
          toolSpan.setInput("text", `Input for tool ${j}`);
          toolSpan.setOutput("text", `Output from tool ${j}`);
          await sleep(20 + Math.floor(Math.random() * 30));
        });
      }

      // Final LLM span
      const promptTokens = 100 + Math.floor(Math.random() * 400);
      const completionTokens = 50 + Math.floor(Math.random() * 200);
      const cost = promptTokens * 0.00003 + completionTokens * 0.00006;

      await tracer.withActiveSpan(`${model} completion`, async (llmSpan) => {
        llmSpan.setType("llm");
        llmSpan.setInput("chat_messages", [
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: `Test message ${i}` },
        ]);
        llmSpan.setOutput("chat_messages", [
          { role: "assistant", content: `Response to test message ${i}` },
        ]);
        llmSpan.setRequestModel(model);
        llmSpan.setResponseModel(model);
        llmSpan.setAttribute(ATTR_GEN_AI_SYSTEM, vendor);
        // Set GenAI semconv token attributes directly for ClickHouse compatibility
        llmSpan.setAttribute(ATTR_GEN_AI_USAGE_PROMPT_TOKENS, promptTokens);
        llmSpan.setAttribute(ATTR_GEN_AI_USAGE_COMPLETION_TOKENS, completionTokens);
        llmSpan.setMetrics({ promptTokens, completionTokens, cost });
        await sleep(50 + Math.floor(Math.random() * 100));
      });

      rootSpan.setOutput("text", `Output from chain ${i}`);
      await sleep(10);
    });
  }
}

/**
 * Generate traces with extensive metadata variations
 */
async function generateMetadataVariationTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  const environments = ["production", "staging", "development"];
  const regions = ["us-east", "us-west", "eu-west"];

  for (let i = 0; i < count; i++) {
    const model = LLM_MODELS[i % LLM_MODELS.length]!;
    const vendor = model.startsWith("gpt") ? "openai" : "anthropic";
    const promptTokens = 100 + Math.floor(Math.random() * 400);
    const completionTokens = 50 + Math.floor(Math.random() * 200);
    const cost = promptTokens * 0.00003 + completionTokens * 0.00006;

    await tracer.withActiveSpan(`${model} completion`, async (span) => {
      span.setType("llm");
      // Set run prefix for trace isolation
      span.setAttribute("run.prefix", runPrefix);
      span.setInput("chat_messages", [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Test message ${i}` },
      ]);
      span.setOutput("chat_messages", [
        { role: "assistant", content: `Response to test message ${i}` },
      ]);
      span.setRequestModel(model);
      span.setResponseModel(model);
      span.setAttribute(ATTR_GEN_AI_SYSTEM, vendor);
      // Set GenAI semconv token attributes directly for ClickHouse compatibility
      span.setAttribute(ATTR_GEN_AI_USAGE_PROMPT_TOKENS, promptTokens);
      span.setAttribute(ATTR_GEN_AI_USAGE_COMPLETION_TOKENS, completionTokens);
      span.setMetrics({ promptTokens, completionTokens, cost });

      // Extensive metadata variations
      span.setAttribute("langwatch.user.id", `user-${(i % 15) + 1}`);
      span.setAttribute("langwatch.thread.id", `thread-${(i % 10) + 1}`);
      span.setAttribute("langwatch.customer.id", `customer-${(i % 5) + 1}`);
      span.setAttribute(
        "metadata",
        JSON.stringify({ labels: [LABELS[i % LABELS.length]!, LABELS[(i + 1) % LABELS.length]!] }),
      );

      // Custom metadata
      span.setAttribute("langwatch.metadata.environment", environments[i % 3]!);
      span.setAttribute("langwatch.metadata.version", `1.${i % 5}.0`);
      span.setAttribute("langwatch.metadata.region", regions[i % 3]!);

      await sleep(50 + Math.floor(Math.random() * 100));
    });
  }
}

/**
 * Generate error traces
 */
async function generateErrorTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    await tracer.withActiveSpan("failed_completion", async (span) => {
      span.setType("llm");
      // Set run prefix for trace isolation
      span.setAttribute("run.prefix", runPrefix);
      span.setInput("text", "This will fail");

      // Set metadata
      span.setAttribute("langwatch.user.id", `user-${(i % 5) + 1}`);
      span.setAttribute("metadata", JSON.stringify({ labels: ["error", LABELS[i % LABELS.length]!] }));

      // Record error
      const error = new Error("API rate limit exceeded");
      error.stack = "at processRequest\nat handleCompletion";
      span.recordException(error);
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: error.message,
      });

      await sleep(20 + Math.floor(Math.random() * 30));
    });
  }
}

/**
 * Generate traces with evaluations
 */
async function generateEvaluationTraces(
  tracer: Tracer,
  runPrefix: string,
  count: number,
): Promise<void> {
  for (let i = 0; i < count; i++) {
    const model = LLM_MODELS[i % LLM_MODELS.length]!;
    const vendor = model.startsWith("gpt") ? "openai" : "anthropic";
    const promptTokens = 100 + Math.floor(Math.random() * 400);
    const completionTokens = 50 + Math.floor(Math.random() * 200);
    const cost = promptTokens * 0.00003 + completionTokens * 0.00006;

    await tracer.withActiveSpan(`${model} completion`, async (span) => {
      span.setType("llm");
      // Set run prefix for trace isolation
      span.setAttribute("run.prefix", runPrefix);
      span.setInput("chat_messages", [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Test message ${i}` },
      ]);
      span.setOutput("chat_messages", [
        { role: "assistant", content: `Response to test message ${i}` },
      ]);
      span.setRequestModel(model);
      span.setResponseModel(model);
      span.setAttribute(ATTR_GEN_AI_SYSTEM, vendor);
      // Set GenAI semconv token attributes directly for ClickHouse compatibility
      span.setAttribute(ATTR_GEN_AI_USAGE_PROMPT_TOKENS, promptTokens);
      span.setAttribute(ATTR_GEN_AI_USAGE_COMPLETION_TOKENS, completionTokens);
      span.setMetrics({ promptTokens, completionTokens, cost });

      // Set metadata
      span.setAttribute("langwatch.user.id", `user-${(i % 7) + 1}`);
      span.setAttribute("metadata", JSON.stringify({ labels: ["evaluated"] }));

      // Generate evaluations as nested spans
      const numEvaluations = 1 + (i % 3);
      for (let j = 0; j < numEvaluations; j++) {
        const evalName = EVALUATION_NAMES[j % EVALUATION_NAMES.length]!;
        const passed = Math.random() > 0.3;
        const score = passed ? 0.7 + Math.random() * 0.3 : Math.random() * 0.4;

        await tracer.withActiveSpan(evalName, async (evalSpan) => {
          evalSpan.setType("evaluation");
          evalSpan.setAttribute("langwatch.evaluation.name", evalName);
          evalSpan.setAttribute("langwatch.evaluation.passed", passed);
          evalSpan.setAttribute("langwatch.evaluation.score", score);
          evalSpan.setAttribute("langwatch.evaluation.label", passed ? "pass" : "fail");
          await sleep(10 + Math.floor(Math.random() * 20));
        });
      }

      await sleep(50 + Math.floor(Math.random() * 100));
    });
  }
}

/**
 * Generate all trace variations directly using OTEL SDK
 */
export async function generateAllVariations(
  tracer: Tracer,
  runPrefix: string,
  config: { tracesPerVariation: number },
  onProgress?: (variationName: string, sent: number, total: number) => void,
): Promise<GenerationResult> {
  const variations: TraceVariationResult[] = [];
  let totalTraces = 0;

  // Record the start time for time range
  const startTime = Date.now();

  // LLM spans
  console.log("  Generating LLM traces...");
  await generateLLMTraces(tracer, runPrefix, config.tracesPerVariation);
  variations.push({
    name: "llm_spans",
    description: "LLM spans with different models, token counts, and costs",
    count: config.tracesPerVariation,
  });
  totalTraces += config.tracesPerVariation;
  onProgress?.("llm_spans", totalTraces, totalTraces);

  // RAG spans
  console.log("  Generating RAG traces...");
  await generateRAGTraces(tracer, runPrefix, config.tracesPerVariation);
  variations.push({
    name: "rag_spans",
    description: "RAG spans with document contexts and nested relationships",
    count: config.tracesPerVariation,
  });
  totalTraces += config.tracesPerVariation;
  onProgress?.("rag_spans", totalTraces, totalTraces);

  // Chain/tool spans
  console.log("  Generating chain/tool traces...");
  await generateChainToolTraces(tracer, runPrefix, config.tracesPerVariation);
  variations.push({
    name: "chain_tool_spans",
    description: "Chain/tool spans with nested parent-child relationships",
    count: config.tracesPerVariation,
  });
  totalTraces += config.tracesPerVariation;
  onProgress?.("chain_tool_spans", totalTraces, totalTraces);

  // Metadata variations
  console.log("  Generating metadata variation traces...");
  await generateMetadataVariationTraces(tracer, runPrefix, config.tracesPerVariation);
  variations.push({
    name: "metadata_variations",
    description: "Traces with various metadata combinations",
    count: config.tracesPerVariation,
  });
  totalTraces += config.tracesPerVariation;
  onProgress?.("metadata_variations", totalTraces, totalTraces);

  // Error traces (fewer)
  const errorCount = Math.floor(config.tracesPerVariation / 4);
  console.log("  Generating error traces...");
  await generateErrorTraces(tracer, runPrefix, errorCount);
  variations.push({
    name: "error_traces",
    description: "Traces with error flags set",
    count: errorCount,
  });
  totalTraces += errorCount;
  onProgress?.("error_traces", totalTraces, totalTraces);

  // Evaluation traces
  console.log("  Generating evaluation traces...");
  await generateEvaluationTraces(tracer, runPrefix, config.tracesPerVariation);
  variations.push({
    name: "evaluation_traces",
    description: "Traces with pass/fail evaluations and scores",
    count: config.tracesPerVariation,
  });
  totalTraces += config.tracesPerVariation;
  onProgress?.("evaluation_traces", totalTraces, totalTraces);

  // Record the end time for time range
  const endTime = Date.now();

  return {
    variations,
    totalTraces,
    timeRange: {
      // Use a small buffer before/after the actual generation time
      startDate: startTime - 60 * 1000, // 1 minute before
      endDate: endTime + 5 * 60 * 1000, // 5 minutes after (for indexing delay)
    },
  };
}
