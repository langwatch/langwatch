/**
 * Generate test traces with various data patterns for analytics verification
 */

import { nanoid } from "nanoid";
import type {
  CollectorRESTParams,
  LLMSpan,
  RAGSpan,
  BaseSpan,
  Span,
  TraceVariation,
  RESTEvaluation,
  ChatMessage,
} from "./types.js";

// Models to use in test data
const LLM_MODELS = [
  "gpt-4",
  "gpt-4-turbo",
  "gpt-3.5-turbo",
  "claude-3-opus",
  "claude-3-sonnet",
];

const VENDORS = ["openai", "anthropic"];

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

/**
 * Generate a base timestamp for the current run
 * Uses a narrow window (last 5 minutes) to avoid counting traces from previous runs
 */
function getBaseTimestamp(): number {
  const now = Date.now();
  // Start 5 minutes ago, spread traces within that window
  return now - 5 * 60 * 1000;
}

/**
 * Create a unique run prefix for trace IDs
 */
export function createRunPrefix(): string {
  return `parity-${nanoid(8)}`;
}

/**
 * Generate a single LLM span
 */
function generateLLMSpan(
  traceId: string,
  parentId: string | null,
  baseTime: number,
  index: number,
): LLMSpan {
  const startedAt = baseTime + index * 100;
  const duration = 500 + Math.floor(Math.random() * 2000);
  const model = LLM_MODELS[index % LLM_MODELS.length]!;
  const vendor = model.startsWith("gpt") ? "openai" : "anthropic";

  const promptTokens = 100 + Math.floor(Math.random() * 400);
  const completionTokens = 50 + Math.floor(Math.random() * 200);
  const cost = (promptTokens * 0.00003 + completionTokens * 0.00006);

  return {
    span_id: `span-${nanoid(12)}`,
    parent_id: parentId,
    trace_id: traceId,
    type: "llm",
    name: `${model} completion`,
    vendor,
    model,
    input: {
      type: "chat_messages",
      value: [
        { role: "system", content: "You are a helpful assistant." },
        { role: "user", content: `Test message ${index}` },
      ] as ChatMessage[],
    },
    output: {
      type: "chat_messages",
      value: [
        { role: "assistant", content: `Response to test message ${index}` },
      ] as ChatMessage[],
    },
    timestamps: {
      started_at: startedAt,
      first_token_at: startedAt + 100,
      finished_at: startedAt + duration,
    },
    metrics: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      cost,
    },
  };
}

/**
 * Generate a RAG span with document contexts
 */
function generateRAGSpan(
  traceId: string,
  parentId: string | null,
  baseTime: number,
  index: number,
): RAGSpan {
  const startedAt = baseTime + index * 50;
  const duration = 200 + Math.floor(Math.random() * 300);

  return {
    span_id: `span-${nanoid(12)}`,
    parent_id: parentId,
    trace_id: traceId,
    type: "rag",
    name: "document retrieval",
    input: {
      type: "text",
      value: `Search query ${index}`,
    },
    output: {
      type: "json",
      value: { retrieved_count: 3 },
    },
    timestamps: {
      started_at: startedAt,
      finished_at: startedAt + duration,
    },
    contexts: [
      {
        document_id: `doc-${(index % 5) + 1}`,
        chunk_id: `chunk-${index}-1`,
        content: `Document content for query ${index}, chunk 1`,
      },
      {
        document_id: `doc-${((index + 1) % 5) + 1}`,
        chunk_id: `chunk-${index}-2`,
        content: `Document content for query ${index}, chunk 2`,
      },
      {
        document_id: `doc-${((index + 2) % 5) + 1}`,
        chunk_id: `chunk-${index}-3`,
        content: `Document content for query ${index}, chunk 3`,
      },
    ],
  };
}

/**
 * Generate a chain/tool span
 */
function generateChainSpan(
  traceId: string,
  parentId: string | null,
  baseTime: number,
  index: number,
  type: "chain" | "tool" = "chain",
): BaseSpan {
  const startedAt = baseTime;
  const duration = 1000 + Math.floor(Math.random() * 3000);

  return {
    span_id: `span-${nanoid(12)}`,
    parent_id: parentId,
    trace_id: traceId,
    type,
    name: type === "chain" ? "main_chain" : `tool_${index}`,
    input: {
      type: "text",
      value: `Input for ${type} ${index}`,
    },
    output: {
      type: "text",
      value: `Output from ${type} ${index}`,
    },
    timestamps: {
      started_at: startedAt,
      finished_at: startedAt + duration,
    },
  };
}

/**
 * Generate an error span
 */
function generateErrorSpan(
  traceId: string,
  parentId: string | null,
  baseTime: number,
): BaseSpan {
  const startedAt = baseTime;

  return {
    span_id: `span-${nanoid(12)}`,
    parent_id: parentId,
    trace_id: traceId,
    type: "llm",
    name: "failed_completion",
    input: {
      type: "text",
      value: "This will fail",
    },
    error: {
      has_error: true,
      message: "API rate limit exceeded",
      stacktrace: ["at processRequest", "at handleCompletion"],
    },
    timestamps: {
      started_at: startedAt,
      finished_at: startedAt + 50,
    },
  };
}

/**
 * Generate evaluations for a trace
 */
function generateEvaluations(traceId: string, index: number): RESTEvaluation[] {
  const evaluations: RESTEvaluation[] = [];
  const numEvaluations = 1 + (index % 3);

  for (let i = 0; i < numEvaluations; i++) {
    const evalName = EVALUATION_NAMES[i % EVALUATION_NAMES.length]!;
    const passed = Math.random() > 0.3;
    const score = passed ? 0.7 + Math.random() * 0.3 : Math.random() * 0.4;

    evaluations.push({
      evaluation_id: `eval-${nanoid(12)}`,
      evaluator_id: `evaluator-${evalName}`,
      name: evalName,
      status: "processed",
      passed,
      score,
      label: passed ? "pass" : "fail",
      timestamps: {
        started_at: Date.now() - 1000,
        finished_at: Date.now(),
      },
    });
  }

  return evaluations;
}

/**
 * Generate LLM trace variations
 */
function generateLLMVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-llm-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const llmSpan = generateLLMSpan(traceId, null, traceTime, i);

    traces.push({
      trace_id: traceId,
      spans: [llmSpan],
      metadata: {
        user_id: `user-${(i % 10) + 1}`,
        thread_id: `thread-${(i % 5) + 1}`,
        labels: [LABELS[i % LABELS.length]!],
      },
    });
  }

  return {
    name: "llm_spans",
    description: "LLM spans with different models, token counts, and costs",
    traces,
  };
}

/**
 * Generate RAG trace variations
 */
function generateRAGVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-rag-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const chainSpan = generateChainSpan(traceId, null, traceTime, i, "chain");
    const ragSpan = generateRAGSpan(traceId, chainSpan.span_id, traceTime + 100, i);
    const llmSpan = generateLLMSpan(traceId, chainSpan.span_id, traceTime + 400, i);

    traces.push({
      trace_id: traceId,
      spans: [chainSpan, ragSpan, llmSpan],
      metadata: {
        user_id: `user-${(i % 8) + 1}`,
        thread_id: `thread-rag-${(i % 3) + 1}`,
        labels: ["rag", LABELS[i % LABELS.length]!],
      },
    });
  }

  return {
    name: "rag_spans",
    description: "RAG spans with document contexts and nested relationships",
    traces,
  };
}

/**
 * Generate chain/tool trace variations
 */
function generateChainVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-chain-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const spans: Span[] = [];
    const chainSpan = generateChainSpan(traceId, null, traceTime, i, "chain");
    spans.push(chainSpan);

    // Add nested tool spans
    const numTools = 2 + (i % 3);
    for (let j = 0; j < numTools; j++) {
      const toolSpan = generateChainSpan(
        traceId,
        chainSpan.span_id,
        traceTime + (j + 1) * 200,
        j,
        "tool",
      );
      spans.push(toolSpan);
    }

    // Add LLM span at the end
    const llmSpan = generateLLMSpan(
      traceId,
      chainSpan.span_id,
      traceTime + (numTools + 1) * 200,
      i,
    );
    spans.push(llmSpan);

    traces.push({
      trace_id: traceId,
      spans,
      metadata: {
        user_id: `user-${(i % 6) + 1}`,
        customer_id: `customer-${(i % 4) + 1}`,
        labels: ["agent", LABELS[i % LABELS.length]!],
      },
    });
  }

  return {
    name: "chain_tool_spans",
    description: "Chain/tool spans with nested parent-child relationships",
    traces,
  };
}

/**
 * Generate metadata variation traces
 */
function generateMetadataVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-meta-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const llmSpan = generateLLMSpan(traceId, null, traceTime, i);

    // Vary metadata extensively
    traces.push({
      trace_id: traceId,
      spans: [llmSpan],
      metadata: {
        user_id: `user-${(i % 15) + 1}`,
        thread_id: `thread-${(i % 10) + 1}`,
        customer_id: `customer-${(i % 5) + 1}`,
        labels: [
          LABELS[i % LABELS.length]!,
          LABELS[(i + 1) % LABELS.length]!,
        ],
        // Custom metadata
        environment: i % 3 === 0 ? "production" : i % 3 === 1 ? "staging" : "development",
        version: `1.${i % 5}.0`,
        region: ["us-east", "us-west", "eu-west"][i % 3],
      },
    });
  }

  return {
    name: "metadata_variations",
    description: "Traces with various metadata combinations",
    traces,
  };
}

/**
 * Generate error trace variations
 */
function generateErrorVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-error-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const errorSpan = generateErrorSpan(traceId, null, traceTime);

    traces.push({
      trace_id: traceId,
      spans: [errorSpan],
      metadata: {
        user_id: `user-${(i % 5) + 1}`,
        labels: ["error", LABELS[i % LABELS.length]!],
      },
    });
  }

  return {
    name: "error_traces",
    description: "Traces with error flags set",
    traces,
  };
}

/**
 * Generate evaluation trace variations
 */
function generateEvaluationVariations(
  runPrefix: string,
  count: number,
  baseTime: number,
): TraceVariation {
  const traces: CollectorRESTParams[] = [];

  for (let i = 0; i < count; i++) {
    const traceId = `${runPrefix}-eval-${i}`;
    const traceTime = baseTime + i * 10 * 1000; // Spread across 10-second intervals

    const llmSpan = generateLLMSpan(traceId, null, traceTime, i);
    const evaluations = generateEvaluations(traceId, i);

    traces.push({
      trace_id: traceId,
      spans: [llmSpan],
      metadata: {
        user_id: `user-${(i % 7) + 1}`,
        labels: ["evaluated"],
      },
      evaluations,
    });
  }

  return {
    name: "evaluation_traces",
    description: "Traces with pass/fail evaluations and scores",
    traces,
  };
}

/**
 * Generate all test variations
 */
export function generateTestVariations(
  runPrefix: string,
  tracesPerVariation: number = 20,
): TraceVariation[] {
  const baseTime = getBaseTimestamp();

  return [
    generateLLMVariations(runPrefix, tracesPerVariation, baseTime),
    generateRAGVariations(runPrefix, tracesPerVariation, baseTime + 1000),
    generateChainVariations(runPrefix, tracesPerVariation, baseTime + 2000),
    generateMetadataVariations(runPrefix, tracesPerVariation, baseTime + 3000),
    generateErrorVariations(runPrefix, Math.floor(tracesPerVariation / 4), baseTime + 4000),
    generateEvaluationVariations(runPrefix, tracesPerVariation, baseTime + 5000),
  ];
}

/**
 * Get total trace count from variations
 */
export function getTotalTraceCount(variations: TraceVariation[]): number {
  return variations.reduce((sum, v) => sum + v.traces.length, 0);
}

/**
 * Get time range covered by variations
 */
export function getTimeRange(variations: TraceVariation[]): {
  startDate: number;
  endDate: number;
} {
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const variation of variations) {
    for (const trace of variation.traces) {
      for (const span of trace.spans) {
        if (span.timestamps.started_at < minTime) {
          minTime = span.timestamps.started_at;
        }
        if (span.timestamps.finished_at > maxTime) {
          maxTime = span.timestamps.finished_at;
        }
      }
    }
  }

  // Add some buffer
  return {
    startDate: minTime - 60 * 60 * 1000, // 1 hour before
    endDate: maxTime + 60 * 60 * 1000, // 1 hour after
  };
}
