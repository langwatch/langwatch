/**
 * Send traces using the LangWatch SDK (via OpenTelemetry)
 * This ensures traces go through the OTEL endpoint which triggers event sourcing for ClickHouse
 */

import { setupObservability, type ObservabilityHandle } from "langwatch/observability/node";
import { getLangWatchTracer, type LangWatchSpan } from "langwatch/observability";
import type { TraceVariation, Span, LLMSpan, RAGSpan, TraceMetadata } from "./types.js";
import { ATTR_GEN_AI_SYSTEM } from "@opentelemetry/semantic-conventions/incubating";
import { SpanStatusCode } from "@opentelemetry/api";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";

interface SendResult {
  success: number;
  failed: number;
  errors: string[];
}

/**
 * Send variations to both ES and CH projects using a single SDK with dual exporters
 *
 * This approach uses a single OpenTelemetry SDK instance with two span processors,
 * each sending to a different project. This avoids the global state issues that occur
 * when trying to reinitialize OpenTelemetry multiple times.
 */
export async function sendVariationsToProjectsWithSDK(
  endpoint: string,
  esApiKey: string,
  chApiKey: string,
  variations: TraceVariation[],
  onProgress?: (project: string, sent: number, total: number) => void,
): Promise<{
  es: SendResult;
  ch: SendResult;
}> {
  const totalTraces = variations.flatMap((v) => v.traces).length;

  // Create exporters for both projects using OTLPTraceExporter directly
  // This allows us to set a longer timeout (default is 10s which is too short)
  const otelEndpoint = `${endpoint}/api/otel/v1/traces`;

  const esExporter = new OTLPTraceExporter({
    url: otelEndpoint,
    headers: {
      authorization: `Bearer ${esApiKey}`,
    },
    timeoutMillis: 120000, // 2 minute timeout
  });

  const chExporter = new OTLPTraceExporter({
    url: otelEndpoint,
    headers: {
      authorization: `Bearer ${chApiKey}`,
    },
    timeoutMillis: 120000, // 2 minute timeout
  });

  // Create batch span processors for both exporters with longer timeouts
  const batchConfig = {
    maxQueueSize: 2048,
    maxExportBatchSize: 512,
    scheduledDelayMillis: 5000, // Export batch every 5 seconds
    exportTimeoutMillis: 60000, // 60 seconds timeout for export
  };

  const esProcessor = new BatchSpanProcessor(esExporter, batchConfig);
  const chProcessor = new BatchSpanProcessor(chExporter, batchConfig);

  console.log(`\nSetting up dual-exporter SDK for ${totalTraces} traces...`);
  console.log(`  ES endpoint: ${endpoint}/api/otel/v1/traces`);
  console.log(`  CH endpoint: ${endpoint}/api/otel/v1/traces`);

  // Setup single SDK with both processors
  const handle = setupObservability({
    langwatch: "disabled", // We provide our own processors
    serviceName: "parity-check",
    debug: { logLevel: "warn" },
    spanProcessors: [esProcessor, chProcessor],
    advanced: {
      UNSAFE_forceOpenTelemetryReinitialization: true,
      disableAutoShutdown: true,
    },
  });

  const tracer = getLangWatchTracer("parity-check");

  // Send traces
  console.log(`\nSending ${totalTraces} traces to both projects simultaneously...`);
  const result = await sendVariationsWithSDK(tracer, variations, (sent, total) => {
    onProgress?.("BOTH", sent, total);
  });

  // Force flush all pending spans before shutdown
  console.log("\nFlushing batch exporters...");
  await esProcessor.forceFlush();
  await chProcessor.forceFlush();

  // Give extra time for network requests to complete
  console.log("Waiting for exports to complete...");
  await sleep(5000);

  // Shutdown SDK
  console.log("Shutting down SDK...");
  await handle.shutdown();

  // Both projects receive the same traces
  return {
    es: result,
    ch: result,
  };
}

/**
 * Send all traces from variations using the SDK
 */
async function sendVariationsWithSDK(
  tracer: ReturnType<typeof getLangWatchTracer>,
  variations: TraceVariation[],
  onProgress?: (sent: number, total: number) => void,
): Promise<SendResult> {
  const result: SendResult = {
    success: 0,
    failed: 0,
    errors: [],
  };

  const allTraces = variations.flatMap((v) => v.traces);
  let sent = 0;

  for (const traceData of allTraces) {
    try {
      await sendSingleTrace(tracer, traceData.spans, traceData.metadata ?? {});
      result.success++;
    } catch (error) {
      result.failed++;
      result.errors.push(
        `Trace ${traceData.trace_id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    sent++;
    onProgress?.(sent, allTraces.length);

    // Small delay between traces to avoid overwhelming the system
    await sleep(50);
  }

  return result;
}

/**
 * Send a single trace with all its spans
 */
async function sendSingleTrace(
  tracer: ReturnType<typeof getLangWatchTracer>,
  spans: Span[],
  metadata: TraceMetadata,
): Promise<void> {
  // Group spans by parent-child relationships
  const rootSpans = spans.filter((s) => !s.parent_id);
  const childSpansByParent = new Map<string, Span[]>();

  for (const span of spans) {
    if (span.parent_id) {
      const children = childSpansByParent.get(span.parent_id) ?? [];
      children.push(span);
      childSpansByParent.set(span.parent_id, children);
    }
  }

  // Create root spans first
  for (const rootSpan of rootSpans) {
    await createSpanHierarchy(tracer, rootSpan, childSpansByParent, metadata);
  }
}

/**
 * Create a span and its children recursively
 */
async function createSpanHierarchy(
  tracer: ReturnType<typeof getLangWatchTracer>,
  spanData: Span,
  childSpansByParent: Map<string, Span[]>,
  metadata: TraceMetadata,
): Promise<void> {
  const duration = spanData.timestamps.finished_at - spanData.timestamps.started_at;

  await tracer.withActiveSpan(
    spanData.name ?? `${spanData.type}-span`,
    {
      startTime: new Date(spanData.timestamps.started_at),
    },
    async (span) => {
      // Set span type
      span.setType(spanData.type);

      // Set metadata attributes (only on root spans)
      if (!spanData.parent_id) {
        setMetadataAttributes(span, metadata);
      }

      // Set input/output
      if (spanData.input) {
        if (spanData.input.type === "text") {
          span.setInput("text", spanData.input.value);
        } else if (spanData.input.type === "chat_messages") {
          span.setInput("chat_messages", spanData.input.value);
        } else if (spanData.input.type === "json") {
          span.setInput("json", spanData.input.value);
        } else {
          span.setInput("raw", spanData.input.value);
        }
      }

      if (spanData.output) {
        if (spanData.output.type === "text") {
          span.setOutput("text", spanData.output.value);
        } else if (spanData.output.type === "chat_messages") {
          span.setOutput("chat_messages", spanData.output.value);
        } else if (spanData.output.type === "json") {
          span.setOutput("json", spanData.output.value);
        } else {
          span.setOutput("raw", spanData.output.value);
        }
      }

      // Set LLM-specific attributes
      if (isLLMSpan(spanData)) {
        if (spanData.model) {
          span.setRequestModel(spanData.model);
          span.setResponseModel(spanData.model);
        }
        if (spanData.vendor) {
          span.setAttribute(ATTR_GEN_AI_SYSTEM, spanData.vendor);
        }
      }

      // Set RAG-specific attributes
      if (isRAGSpan(spanData)) {
        span.setRAGContexts(
          spanData.contexts.map((ctx) => ({
            document_id: ctx.document_id ?? "unknown",
            chunk_id: ctx.chunk_id ?? "unknown",
            content: ctx.content,
          })),
        );
      }

      // Set metrics
      if (spanData.metrics) {
        span.setMetrics({
          promptTokens: spanData.metrics.prompt_tokens ?? undefined,
          completionTokens: spanData.metrics.completion_tokens ?? undefined,
          cost: spanData.metrics.cost ?? undefined,
        });
      }

      // Handle errors
      if (spanData.error?.has_error) {
        const error = new Error(spanData.error.message);
        error.stack = spanData.error.stacktrace.join("\n");
        span.recordException(error);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: spanData.error.message,
        });
      }

      // Create child spans
      const children = childSpansByParent.get(spanData.span_id) ?? [];
      for (const childSpan of children) {
        await createSpanHierarchy(tracer, childSpan, childSpansByParent, metadata);
      }

      // Wait for the span duration
      // Note: The actual timing is controlled by the start/end times
      await sleep(Math.min(duration, 10)); // Cap wait to avoid very long delays
    },
  );
}

/**
 * Set trace metadata as span attributes
 */
function setMetadataAttributes(span: LangWatchSpan, metadata: TraceMetadata): void {
  if (metadata.user_id) {
    span.setAttribute("langwatch.user.id", metadata.user_id);
  }
  if (metadata.thread_id) {
    span.setAttribute("langwatch.thread.id", metadata.thread_id);
  }
  if (metadata.customer_id) {
    span.setAttribute("langwatch.customer.id", metadata.customer_id);
  }
  if (metadata.labels && metadata.labels.length > 0) {
    span.setAttribute("langwatch.tags", JSON.stringify(metadata.labels));
  }

  // Set any additional custom metadata
  for (const [key, value] of Object.entries(metadata)) {
    if (
      !["user_id", "thread_id", "customer_id", "labels"].includes(key) &&
      value !== undefined &&
      value !== null
    ) {
      const attrValue = typeof value === "string" ? value : JSON.stringify(value);
      span.setAttribute(`langwatch.metadata.${key}`, attrValue);
    }
  }
}

/**
 * Type guard for LLM spans
 */
function isLLMSpan(span: Span): span is LLMSpan {
  return span.type === "llm";
}

/**
 * Type guard for RAG spans
 */
function isRAGSpan(span: Span): span is RAGSpan {
  return span.type === "rag" && "contexts" in span;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
