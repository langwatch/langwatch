import type { Tracer, Context } from "@opentelemetry/api";
import type { SpanConfig, TraceConfig } from "./types";

export async function executeTrace({
  trace: traceConfig,
  apiKey,
  endpoint,
}: {
  trace: TraceConfig;
  apiKey: string;
  endpoint: string;
}): Promise<string> {
  // Lazy-import OTel modules — they pull in Node.js polyfills that break SSR
  const { createFoundryProvider } = await import("./otelBrowser");
  const { context, trace, SpanStatusCode, ROOT_CONTEXT } =
    await import("@opentelemetry/api");

  const provider = createFoundryProvider({
    apiKey,
    endpoint,
    resourceAttributes: traceConfig.resourceAttributes,
  });

  const tracer = provider.getTracer("foundry", "1.0.0");
  const now = Date.now();

  let traceId = "";
  for (const spanConfig of traceConfig.spans) {
    const spanTraceId = buildSpan(tracer, spanConfig, ROOT_CONTEXT, now, traceConfig, {
      context,
      trace,
      SpanStatusCode,
    });
    if (!traceId) traceId = spanTraceId;
  }

  await provider.forceFlush();
  await provider.shutdown();

  return traceId;
}

function buildSpan(
  tracer: Tracer,
  config: SpanConfig,
  parentContext: Context,
  baseTime: number,
  traceConfig: TraceConfig,
  otel: {
    context: typeof import("@opentelemetry/api").context;
    trace: typeof import("@opentelemetry/api").trace;
    SpanStatusCode: typeof import("@opentelemetry/api").SpanStatusCode;
  }
): string {
  const startTimeMs = baseTime + config.offsetMs;
  const endTimeMs = startTimeMs + config.durationMs;

  const span = tracer.startSpan(
    config.name,
    { startTime: new Date(startTimeMs) },
    parentContext
  );

  span.setAttribute("langwatch.span.type", config.type);

  if (config.input) {
    span.setAttribute("langwatch.input", JSON.stringify(config.input));
  }
  if (config.output) {
    span.setAttribute("langwatch.output", JSON.stringify(config.output));
  }

  // Metadata on root spans
  if (parentContext === otel.context.active() || !parentContext) {
    if (traceConfig.metadata.userId) {
      span.setAttribute("langwatch.user.id", traceConfig.metadata.userId);
    }
    if (traceConfig.metadata.threadId) {
      span.setAttribute("langwatch.thread.id", traceConfig.metadata.threadId);
    }
    if (traceConfig.metadata.customerId) {
      span.setAttribute("langwatch.customer.id", traceConfig.metadata.customerId);
    }
    if (traceConfig.metadata.labels?.length) {
      span.setAttribute("langwatch.labels", traceConfig.metadata.labels);
    }
  }

  // LLM attributes
  if (config.llm) {
    if (config.llm.requestModel) {
      span.setAttribute("gen_ai.request.model", config.llm.requestModel);
    }
    if (config.llm.responseModel) {
      span.setAttribute("gen_ai.response.model", config.llm.responseModel);
    }
    if (config.llm.temperature !== undefined) {
      span.setAttribute("gen_ai.request.temperature", config.llm.temperature);
    }
    if (config.llm.messages) {
      span.setAttribute(
        "langwatch.input",
        JSON.stringify({ type: "chat_messages", value: config.llm.messages })
      );
      const lastAssistant = [...config.llm.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant) {
        span.setAttribute(
          "langwatch.output",
          JSON.stringify({ type: "text", value: lastAssistant.content })
        );
      }
    }
    if (config.llm.metrics) {
      span.setAttribute(
        "langwatch.metrics",
        JSON.stringify({
          prompt_tokens: config.llm.metrics.promptTokens,
          completion_tokens: config.llm.metrics.completionTokens,
          cost: config.llm.metrics.cost,
        })
      );
    }
    if (config.llm.stream) {
      span.setAttribute("langwatch.gen_ai.streaming", true);
    }
  }

  if (config.rag?.contexts.length) {
    span.setAttribute("langwatch.contexts", JSON.stringify(config.rag.contexts));
  }

  if (config.prompt) {
    if (config.prompt.promptId) {
      span.setAttribute("langwatch.prompt.id", config.prompt.promptId);
    }
    if (config.prompt.versionId) {
      span.setAttribute("langwatch.prompt.version.id", config.prompt.versionId);
    }
    if (config.prompt.variables) {
      span.setAttribute(
        "langwatch.prompt.variables",
        JSON.stringify(config.prompt.variables)
      );
    }
  }

  for (const [key, value] of Object.entries(config.attributes)) {
    span.setAttribute(key, value);
  }

  if (config.status === "error") {
    span.setStatus({
      code: otel.SpanStatusCode.ERROR,
      message: config.exception?.message,
    });
    if (config.exception) {
      span.recordException({
        message: config.exception.message,
        stack: config.exception.stackTrace,
      });
    }
  } else if (config.status === "ok") {
    span.setStatus({ code: otel.SpanStatusCode.OK });
  }

  const childContext = otel.trace.setSpan(parentContext, span);
  for (const child of config.children) {
    buildSpan(tracer, child, childContext, startTimeMs, traceConfig, otel);
  }

  span.end(new Date(endTimeMs));

  return span.spanContext().traceId;
}
