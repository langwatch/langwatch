import type { Tracer, Context } from "@opentelemetry/api";
import { context, trace, SpanStatusCode, ROOT_CONTEXT } from "@opentelemetry/api";
import { createFoundryProvider } from "./otelBrowser";
import type { SpanConfig, TraceConfig } from "./types";

interface ExecutorOpts {
  apiKey: string;
  endpoint: string;
  /** Required when apiKey is a PAT — see createFoundryProvider. */
  projectId?: string;
  /**
   * Resource attributes for the OTel provider. Fixed at executor
   * creation time — to emit traces with different resource attrs, get a
   * separate executor (the cache keys on `service.name`).
   */
  resourceAttributes?: Record<string, string>;
}

interface FoundryExecutor {
  executeTrace(traceConfig: TraceConfig): Promise<string>;
  executeTraces(traces: TraceConfig[]): Promise<string[]>;
  /** forceFlush without shutdown — leaves the provider warm. */
  flush(): Promise<void>;
  /**
   * Flushes anything buffered in the BatchSpanProcessor, then shuts
   * down the provider. Spans you've already handed off still get sent.
   * Caller is responsible for not calling executeTrace* after close.
   */
  close(): Promise<void>;
}

const otelDeps = { context, trace, SpanStatusCode } as const;

/**
 * Cache of long-lived executors keyed on the credential / endpoint /
 * service.name tuple. Foundry's interactive workflow fires N
 * independent send actions per session; building a fresh provider +
 * BatchSpanProcessor + exporter for every click (and tearing them down
 * with two 250ms settles inside `close()`) was pure overhead. With
 * this cache, the first send warms the pipeline and every subsequent
 * send reuses it. Teardown happens once at page-hide.
 */
const executorCache = new Map<string, FoundryExecutor>();
let pageHideHookInstalled = false;

function executorCacheKey(opts: ExecutorOpts): string {
  return [
    opts.apiKey,
    opts.projectId ?? "",
    opts.endpoint,
    opts.resourceAttributes?.["service.name"] ?? "",
  ].join("|");
}

function ensurePageHideHook(): void {
  if (pageHideHookInstalled || typeof window === "undefined") return;
  pageHideHookInstalled = true;
  // `pagehide` is the browser-blessed "tab is going away" signal —
  // including bfcache and tab close, unlike `beforeunload` which
  // doesn't fire reliably on mobile. We don't await; the browser is
  // tearing the page down regardless. Best-effort flush + shutdown.
  window.addEventListener("pagehide", () => {
    for (const executor of executorCache.values()) {
      void executor.close();
    }
    executorCache.clear();
  });
}

/**
 * Returns a cached executor for the given credential + endpoint, or
 * creates one on first call. Subsequent calls with the same options
 * reuse the same provider — no per-call setup/teardown cost. The
 * caller never closes the executor; the page-hide handler does it.
 */
export function getFoundryExecutor(opts: ExecutorOpts): FoundryExecutor {
  ensurePageHideHook();
  const key = executorCacheKey(opts);
  const cached = executorCache.get(key);
  if (cached) return cached;
  const fresh = createFoundryExecutor(opts);
  executorCache.set(key, fresh);
  return fresh;
}

/**
 * Closes and evicts every cached executor. Tests use this to force a
 * clean slate between cases; production code rarely needs it (the
 * page-hide hook handles real teardown).
 */
async function closeAllFoundryExecutors(): Promise<void> {
  const all = [...executorCache.values()];
  executorCache.clear();
  await Promise.all(all.map((e) => e.close()));
}

/**
 * Build a fresh provider-backed executor. Prefer `getFoundryExecutor`
 * unless you need an isolated lifecycle (e.g. a test that owns the
 * provider it tears down).
 */
function createFoundryExecutor(opts: ExecutorOpts): FoundryExecutor {
  const provider = createFoundryProvider({
    apiKey: opts.apiKey,
    endpoint: opts.endpoint,
    projectId: opts.projectId,
    resourceAttributes: opts.resourceAttributes ?? {},
  });
  const tracer = provider.getTracer("foundry", "1.0.0");

  const emitTrace = (traceConfig: TraceConfig): string => {
    const now = Date.now();
    let traceId = "";
    for (const spanConfig of traceConfig.spans) {
      const id = buildSpan(
        tracer,
        spanConfig,
        ROOT_CONTEXT,
        now,
        traceConfig,
        otelDeps,
      );
      if (!traceId) traceId = id;
    }
    return traceId;
  };

  return {
    async executeTrace(traceConfig) {
      const id = emitTrace(traceConfig);
      await provider.forceFlush();
      return id;
    },

    async executeTraces(traces) {
      if (traces.length === 0) return [];
      const traceIds: string[] = [];
      for (const traceConfig of traces) {
        traceIds.push(emitTrace(traceConfig));
      }
      await provider.forceFlush();
      return traceIds;
    },

    async flush() {
      await provider.forceFlush();
    },

    async close() {
      // forceFlush awaits in-flight exports; settle for a tick so
      // shutdown() can't cancel a fetch that's 99% done, then settle
      // again post-shutdown so any retry the OTel SDK schedules has
      // a chance to complete.
      await provider.forceFlush();
      await new Promise((resolve) => setTimeout(resolve, 250));
      await provider.shutdown();
      await new Promise((resolve) => setTimeout(resolve, 250));
    },
  };
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

  // LLM spans emit the OTel gen-AI semantic conventions in full —
  // attributes for the request/response shape and events for each chat
  // turn — alongside the legacy `langwatch.*` keys our projection still
  // reads. The dual emission means an external OTel collector pointed at
  // these traces sees a spec-compliant LLM span without us losing the
  // trace-summary rollup.
  if (config.llm) {
    span.setAttribute("gen_ai.operation.name", "chat");
    const system = inferGenAiSystem(
      config.llm.requestModel ?? config.llm.responseModel,
    );
    if (system) span.setAttribute("gen_ai.system", system);
    if (config.llm.requestModel) {
      span.setAttribute("gen_ai.request.model", config.llm.requestModel);
    }
    if (config.llm.responseModel) {
      span.setAttribute("gen_ai.response.model", config.llm.responseModel);
    }
    if (config.llm.temperature !== undefined) {
      span.setAttribute("gen_ai.request.temperature", config.llm.temperature);
    }
    if (config.llm.stream) {
      span.setAttribute("gen_ai.request.streaming", true);
    }
    if (config.llm.messages) {
      // Per-turn events: `gen_ai.system.message`, `gen_ai.user.message`,
      // `gen_ai.assistant.message`, `gen_ai.tool.message`. The body
      // carries `role` + `content` per the semconv.
      for (const msg of config.llm.messages) {
        span.addEvent(
          `gen_ai.${msg.role}.message`,
          { role: msg.role, content: msg.content },
          new Date(startTimeMs),
        );
      }
      const lastAssistant = [...config.llm.messages]
        .reverse()
        .find((m) => m.role === "assistant");
      if (lastAssistant) {
        span.addEvent(
          "gen_ai.choice",
          {
            index: 0,
            finish_reason: "stop",
            message: JSON.stringify({
              role: "assistant",
              content: lastAssistant.content,
            }),
          },
          new Date(endTimeMs),
        );
      }
      span.setAttribute(
        "langwatch.input",
        JSON.stringify({ type: "chat_messages", value: config.llm.messages }),
      );
      if (lastAssistant) {
        span.setAttribute(
          "langwatch.output",
          JSON.stringify({ type: "text", value: lastAssistant.content }),
        );
      }
    }
    if (config.llm.metrics) {
      if (config.llm.metrics.promptTokens !== undefined) {
        span.setAttribute(
          "gen_ai.usage.input_tokens",
          config.llm.metrics.promptTokens,
        );
      }
      if (config.llm.metrics.completionTokens !== undefined) {
        span.setAttribute(
          "gen_ai.usage.output_tokens",
          config.llm.metrics.completionTokens,
        );
      }
      span.setAttribute(
        "langwatch.metrics",
        JSON.stringify({
          prompt_tokens: config.llm.metrics.promptTokens,
          completion_tokens: config.llm.metrics.completionTokens,
          cost: config.llm.metrics.cost,
        }),
      );
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

/**
 * Map a model string to the OTel `gen_ai.system` enum value. Heuristic:
 * we only have the model name on hand, so we infer the vendor from
 * common prefixes/families. Returns undefined for unknown models so we
 * don't emit a misleading vendor.
 */
function inferGenAiSystem(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const m = model.toLowerCase();
  if (m.startsWith("gpt") || m.startsWith("o1") || m.startsWith("o3"))
    return "openai";
  if (m.includes("claude")) return "anthropic";
  if (m.includes("gemini") || m.includes("palm")) return "vertex_ai";
  if (m.includes("mistral") || m.includes("mixtral")) return "mistral_ai";
  if (m.includes("llama")) return "meta";
  if (m.includes("cohere") || m.startsWith("command")) return "cohere";
  return undefined;
}
