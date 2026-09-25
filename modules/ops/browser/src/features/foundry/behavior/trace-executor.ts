import { nowInstant, Temporal, toDate } from "@langwatch/time";
import type { Context, Span, Tracer } from "@opentelemetry/api";
import { context, ROOT_CONTEXT, SpanStatusCode, trace } from "@opentelemetry/api";
import type * as apiModule from "@opentelemetry/api";

import type {
  ChatMessage,
  LLMConfig,
  PromptConfig,
  SpanConfig,
  SpanEvent,
  SpanMetrics,
  TraceConfig,
  TraceMetadata,
} from "../model/foundry-types.ts";
import { createFoundryProvider } from "./otel-browser.ts";

interface ExecutorOpts {
  apiKey: string;
  endpoint: string;
  /** Required when apiKey is a scoped API key — see createFoundryProvider. */
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
 * Cache long-lived executors (credential/endpoint/service.name); avoids rebuild per click. Teardown
 * at page-hide.
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
 * Cached executor (reuses same provider for same options); caller doesn't close (page-hide handler
 * does).
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
    const now = nowInstant().epochMilliseconds;
    let traceId = "";
    for (const spanConfig of traceConfig.spans) {
      const id = buildSpan({
        tracer,
        config: spanConfig,
        parentContext: ROOT_CONTEXT,
        baseTime: now,
        traceConfig,
        otel: otelDeps,
      });
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

/** The `Date` the OpenTelemetry span API takes for a moment. */
function spanTime(epochMs: number) {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

function buildSpan({
  tracer,
  config,
  parentContext,
  baseTime,
  traceConfig,
  otel,
}: {
  tracer: Tracer;
  config: SpanConfig;
  parentContext: Context;
  baseTime: number;
  traceConfig: TraceConfig;
  otel: {
    context: typeof apiModule.context;
    trace: typeof apiModule.trace;
    SpanStatusCode: typeof apiModule.SpanStatusCode;
  };
}): string {
  const startTimeMs = baseTime + config.offsetMs;
  const endTimeMs = startTimeMs + config.durationMs;

  const span = tracer.startSpan(config.name, { startTime: spanTime(startTimeMs) }, parentContext);

  setSpanPayload(span, config);
  if (parentContext === otel.context.active() || !parentContext) {
    setRootMetadata(span, traceConfig.metadata);
  }
  if (config.llm) recordLlm({ span, llm: config.llm, startTimeMs, endTimeMs });

  const ragContexts = config.rag?.contexts;
  if (ragContexts?.length) {
    span.setAttribute("langwatch.rag.contexts", JSON.stringify(ragContexts));
  }
  if (config.prompt) setPromptReference(span, config.prompt);
  recordEvents({ span, events: config.events ?? [], startTimeMs });

  for (const [key, value] of Object.entries(config.attributes)) {
    span.setAttribute(key, value);
  }
  setSpanStatus({ span, config, statusCodes: otel.SpanStatusCode });

  const childContext = otel.trace.setSpan(parentContext, span);
  for (const child of config.children) {
    buildSpan({
      tracer,
      config: child,
      parentContext: childContext,
      baseTime: startTimeMs,
      traceConfig,
      otel,
    });
  }

  span.end(spanTime(endTimeMs));

  return span.spanContext().traceId;
}

function setSpanPayload(span: Span, config: SpanConfig): void {
  span.setAttribute("langwatch.span.type", config.type);
  // Foundry-emitted traces are always tagged "sample" so they're trivial to
  // isolate from real production traffic via `origin:sample`; user-supplied
  // attributes are set later, so a workflow can still override it per span.
  span.setAttribute("langwatch.origin", "sample");
  if (config.input) span.setAttribute("langwatch.input", JSON.stringify(config.input));
  if (config.output) span.setAttribute("langwatch.output", JSON.stringify(config.output));
}

function setRootMetadata(span: Span, metadata: TraceMetadata): void {
  if (metadata.userId) span.setAttribute("langwatch.user.id", metadata.userId);
  if (metadata.threadId) span.setAttribute("langwatch.thread.id", metadata.threadId);
  if (metadata.customerId) span.setAttribute("langwatch.customer.id", metadata.customerId);
  if (metadata.labels?.length) span.setAttribute("langwatch.labels", metadata.labels);
}

/** OTel gen-AI semantic conventions beside the legacy langwatch keys, for the summary rollup. */
function recordLlm({
  span,
  llm,
  startTimeMs,
  endTimeMs,
}: {
  span: Span;
  llm: LLMConfig;
  startTimeMs: number;
  endTimeMs: number;
}): void {
  span.setAttribute("gen_ai.operation.name", "chat");
  const system = inferGenAiSystem(llm.requestModel ?? llm.responseModel);
  if (system) span.setAttribute("gen_ai.system", system);
  if (llm.requestModel) span.setAttribute("gen_ai.request.model", llm.requestModel);
  if (llm.responseModel) span.setAttribute("gen_ai.response.model", llm.responseModel);
  if (llm.temperature !== undefined) {
    span.setAttribute("gen_ai.request.temperature", llm.temperature);
  }
  if (llm.stream) span.setAttribute("gen_ai.request.streaming", true);
  if (llm.messages) recordLlmMessages({ span, messages: llm.messages, startTimeMs, endTimeMs });
  if (llm.metrics) recordLlmMetrics(span, llm.metrics);
}

/** One `gen_ai.<role>.message` event per turn, then the last assistant turn as the choice. */
function recordLlmMessages({
  span,
  messages,
  startTimeMs,
  endTimeMs,
}: {
  span: Span;
  messages: ChatMessage[];
  startTimeMs: number;
  endTimeMs: number;
}): void {
  for (const msg of messages) {
    span.addEvent(
      `gen_ai.${msg.role}.message`,
      { role: msg.role, content: msg.content },
      spanTime(startTimeMs),
    );
  }
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  if (lastAssistant) {
    span.addEvent(
      "gen_ai.choice",
      {
        index: 0,
        finish_reason: "stop",
        message: JSON.stringify({ role: "assistant", content: lastAssistant.content }),
      },
      spanTime(endTimeMs),
    );
  }
  span.setAttribute("langwatch.input", JSON.stringify({ type: "chat_messages", value: messages }));
  if (lastAssistant) {
    span.setAttribute(
      "langwatch.output",
      JSON.stringify({ type: "text", value: lastAssistant.content }),
    );
  }
}

function recordLlmMetrics(span: Span, metrics: SpanMetrics): void {
  if (metrics.promptTokens !== undefined) {
    span.setAttribute("gen_ai.usage.input_tokens", metrics.promptTokens);
  }
  if (metrics.completionTokens !== undefined) {
    span.setAttribute("gen_ai.usage.output_tokens", metrics.completionTokens);
  }
  span.setAttribute(
    "langwatch.metrics",
    JSON.stringify({
      prompt_tokens: metrics.promptTokens,
      completion_tokens: metrics.completionTokens,
      cost: metrics.cost,
    }),
  );
}

function setPromptReference(span: Span, prompt: PromptConfig): void {
  if (prompt.promptId) setPromptId(span, { ...prompt, promptId: prompt.promptId });
  if (prompt.versionId) span.setAttribute("langwatch.prompt.version.id", prompt.versionId);
  // The pin set on the call site; the drawer flags drift when it differs from the runtime id.
  if (prompt.selectedId) span.setAttribute("langwatch.prompt.selected.id", prompt.selectedId);
  if (prompt.variables) {
    span.setAttribute("langwatch.prompt.variables", JSON.stringify(prompt.variables));
  }
}

/**
 * The trace-summary projection only registers `handle:version_or_tag` ids, so a bare slug is
 * coerced into that shorthand; a numeric version also writes the separate handle/number keys,
 * which the server's `parsePromptReference` accepts too.
 */
function setPromptId(span: Span, prompt: PromptConfig & { promptId: string }): void {
  const raw = prompt.promptId;
  const versionRef = prompt.version ?? prompt.versionId;
  const id = raw.includes(":") || !versionRef ? raw : `${raw}:${versionRef}`;
  span.setAttribute("langwatch.prompt.id", id);
  if (typeof prompt.version === "number") {
    const slug = raw.includes(":") ? raw.split(":")[0]! : raw;
    span.setAttribute("langwatch.prompt.handle", slug);
    span.setAttribute("langwatch.prompt.version.number", prompt.version);
  }
}

function recordEvents({
  span,
  events,
  startTimeMs,
}: {
  span: Span;
  events: SpanEvent[];
  startTimeMs: number;
}): void {
  for (const event of events) {
    const attrs = Object.fromEntries(
      Object.entries(event.attributes).map(([k, v]) => [
        k,
        typeof v === "string" ? v : JSON.stringify(v),
      ]),
    );
    span.addEvent(event.name, attrs, spanTime(startTimeMs + (event.offsetMs ?? 0)));
  }
}

function setSpanStatus({
  span,
  config,
  statusCodes,
}: {
  span: Span;
  config: SpanConfig;
  statusCodes: typeof apiModule.SpanStatusCode;
}): void {
  if (config.status === "ok") {
    span.setStatus({ code: statusCodes.OK });
    return;
  }
  if (config.status !== "error") return;
  span.setStatus({ code: statusCodes.ERROR, message: config.exception?.message });
  if (config.exception) {
    span.recordException({
      message: config.exception.message,
      stack: config.exception.stackTrace,
    });
  }
}

/** The vendor families a model id alone can name, in the order they are tested. */
const GEN_AI_SYSTEMS: { system: string; prefixes?: string[]; fragments?: string[] }[] = [
  { system: "openai", prefixes: ["gpt", "o1", "o3"] },
  { system: "anthropic", fragments: ["claude"] },
  { system: "vertex_ai", fragments: ["gemini", "palm"] },
  { system: "mistral_ai", fragments: ["mistral", "mixtral"] },
  { system: "meta", fragments: ["llama"] },
  { system: "cohere", prefixes: ["command"], fragments: ["cohere"] },
];

/**
 * Map model string to OTel gen_ai.system; heuristic infers vendor from prefixes/families. Undefined
 * for unknown (avoids misleading vendor).
 */
function inferGenAiSystem(model: string | undefined): string | undefined {
  if (!model) return undefined;
  const id = model.toLowerCase();
  const family = GEN_AI_SYSTEMS.find(
    ({ prefixes = [], fragments = [] }) =>
      prefixes.some((prefix) => id.startsWith(prefix)) ||
      fragments.some((fragment) => id.includes(fragment)),
  );
  return family?.system;
}
