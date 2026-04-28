import type { Tracer, Context } from "@opentelemetry/api";
import { context, trace, SpanStatusCode, ROOT_CONTEXT } from "@opentelemetry/api";
import { createFoundryProvider } from "./otelBrowser";
import type { SpanConfig, TraceConfig } from "./types";

export async function executeTrace({
  trace: traceConfig,
  apiKey,
  endpoint,
  projectId,
}: {
  trace: TraceConfig;
  apiKey: string;
  endpoint: string;
  /** Required when apiKey is a PAT — see createFoundryProvider. */
  projectId?: string;
}): Promise<string> {

  const provider = createFoundryProvider({
    apiKey,
    endpoint,
    projectId,
    resourceAttributes: traceConfig.resourceAttributes,
  });

  const tracer = provider.getTracer("foundry", "1.0.0");
  const now = Date.now();

  let traceId = "";

  try {
    for (const spanConfig of traceConfig.spans) {
      const spanTraceId = buildSpan(tracer, spanConfig, ROOT_CONTEXT, now, traceConfig, {
        context,
        trace,
        SpanStatusCode,
      });
      if (!traceId) traceId = spanTraceId;
    }
  } finally {
    await provider.forceFlush();
    await provider.shutdown();
  }

  return traceId;
}

/**
 * Batch variant: emits multiple traces against a single provider. Per-trace
 * setup/teardown of the OTel exporter pool causes the browser to stall on
 * the second request ("provisional headers"), because the connection from
 * the previous (now-shutdown) provider isn't released cleanly into the
 * shared keepalive pool. Reusing one provider keeps a single HTTP/exporter
 * pipeline alive across the whole batch and lets the OTLP BatchSpanProcessor
 * coalesce into fewer, larger requests.
 *
 * Resource attributes are taken from the first trace — they're per-resource
 * (e.g. service name) and consistent across the batch in our use case.
 */
export async function executeTraces({
  traces,
  apiKey,
  endpoint,
  projectId,
}: {
  traces: TraceConfig[];
  apiKey: string;
  endpoint: string;
  /** Required when apiKey is a PAT — see createFoundryProvider. */
  projectId?: string;
}): Promise<string[]> {
  if (traces.length === 0) return [];

  const provider = createFoundryProvider({
    apiKey,
    endpoint,
    projectId,
    resourceAttributes: traces[0]!.resourceAttributes,
  });

  const tracer = provider.getTracer("foundry", "1.0.0");
  const traceIds: string[] = [];

  try {
    for (const traceConfig of traces) {
      // Per-trace baseTime keeps spans within a trace temporally consistent
      // while still spreading traces across the batch's wall-clock window.
      const now = Date.now();
      let traceId = "";
      for (const spanConfig of traceConfig.spans) {
        const spanTraceId = buildSpan(
          tracer,
          spanConfig,
          ROOT_CONTEXT,
          now,
          traceConfig,
          { context, trace, SpanStatusCode },
        );
        if (!traceId) traceId = spanTraceId;
      }
      traceIds.push(traceId);
    }
  } finally {
    // forceFlush awaits the in-flight export promises, but the underlying
    // FetchTransport has a tiny micro-window between "promise resolves"
    // and "browser actually finishes writing the request body / reading
    // the response". Settle for a tick so a subsequent shutdown() can't
    // cancel a fetch that's 99% done, and so any caller-driven navigation
    // (e.g. router.replace) doesn't tear the page down mid-write.
    await provider.forceFlush();
    await new Promise((resolve) => setTimeout(resolve, 250));
    await provider.shutdown();
    // One more settle after shutdown so any retry the OTel SDK schedules
    // on a transient failure has a chance to complete before this scope's
    // resources are reclaimed.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  return traceIds;
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
  // Foundry-emitted traces are always tagged "sample" so they're trivial to
  // isolate from real production traffic via `origin:sample`. Set early so
  // user-supplied attributes can still override per-span if a future
  // workflow needs to (e.g., simulated production replay).
  span.setAttribute("langwatch.origin", "sample");

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
    span.setAttribute("langwatch.rag.contexts", JSON.stringify(config.rag.contexts));
  }

  if (config.prompt) {
    if (config.prompt.promptId) {
      // The trace-summary projection only registers prompt ids in the
      // canonical `handle:version_or_tag` shorthand — bare slugs (no
      // colon) get dropped, which means no `langwatch.prompt_ids` union
      // and no chips on the drawer. Coerce bare slugs into shorthand so
      // Foundry-emitted traces participate in the prompt rollup.
      const raw = config.prompt.promptId;
      const versionRef = config.prompt.version ?? config.prompt.versionId;
      const id =
        raw.includes(":") || !versionRef ? raw : `${raw}:${versionRef}`;
      span.setAttribute("langwatch.prompt.id", id);

      // Also emit the separate-format keys when we have a numeric
      // version. The server's `parsePromptReference` accepts either form,
      // and writing both makes the rollup robust to either projection
      // path.
      if (typeof config.prompt.version === "number") {
        const slug = raw.includes(":") ? raw.split(":")[0]! : raw;
        span.setAttribute("langwatch.prompt.handle", slug);
        span.setAttribute(
          "langwatch.prompt.version.number",
          config.prompt.version,
        );
      }
    }
    if (config.prompt.versionId) {
      span.setAttribute("langwatch.prompt.version.id", config.prompt.versionId);
    }
    if (config.prompt.selectedId) {
      // The pin the developer set on the call site. The projection
      // records this verbatim into `SelectedPromptId`; when it differs
      // from the resolved runtime id the drawer flags drift.
      span.setAttribute("langwatch.prompt.selected.id", config.prompt.selectedId);
    }
    if (config.prompt.variables) {
      span.setAttribute(
        "langwatch.prompt.variables",
        JSON.stringify(config.prompt.variables)
      );
    }
  }

  if (config.events) {
    for (const event of config.events) {
      const eventTimeMs = startTimeMs + (event.offsetMs ?? 0);
      const attrs: Record<string, string> = {};
      for (const [k, v] of Object.entries(event.attributes)) {
        attrs[k] = typeof v === "string" ? v : JSON.stringify(v);
      }
      span.addEvent(event.name, attrs, new Date(eventTimeMs));
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
