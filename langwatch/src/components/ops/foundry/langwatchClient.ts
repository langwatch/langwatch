import { shortId } from "./types";
import type { TraceConfig, SpanConfig, SpanType } from "./types";


interface LangWatchSpan {
  span_id: string;
  parent_id?: string | null;
  trace_id: string;
  type: string;
  name?: string | null;
  input?: { type: string; value: unknown } | null;
  output?: { type: string; value: unknown } | null;
  error?: { message: string; stacktrace?: string } | null;
  timestamps: { started_at: number; finished_at: number };
  metrics?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    cost?: number;
  } | null;
  model?: string | null;
  params?: Record<string, unknown> | null;
}

interface LangWatchTrace {
  trace_id: string;
  metadata?: Record<string, unknown>;
  spans: LangWatchSpan[];
}

export async function fetchTraceById({
  traceId,
  apiKey,
  endpoint,
}: {
  traceId: string;
  apiKey: string;
  endpoint: string;
}): Promise<TraceConfig> {
  const response = await fetch(`${endpoint}/api/trace/${traceId}`, {
    headers: {
      "X-Auth-Token": apiKey,
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch trace: HTTP ${response.status}`);
  }

  const trace: LangWatchTrace = await response.json();
  return convertToTraceConfig(trace);
}

function convertToTraceConfig(trace: LangWatchTrace): TraceConfig {
  const spanMap = new Map<string, LangWatchSpan>();
  const childMap = new Map<string, LangWatchSpan[]>();

  for (const span of trace.spans) {
    spanMap.set(span.span_id, span);
    const parentId = span.parent_id ?? "__root__";
    const children = childMap.get(parentId) ?? [];
    children.push(span);
    childMap.set(parentId, children);
  }

  const rootSpans = childMap.get("__root__") ?? trace.spans.filter((s) => !s.parent_id);

  function buildSpanConfig(lwSpan: LangWatchSpan): SpanConfig {
    const children = (childMap.get(lwSpan.span_id) ?? []).map(buildSpanConfig);
    const duration = lwSpan.timestamps.finished_at - lwSpan.timestamps.started_at;
    const type = (lwSpan.type ?? "span") as SpanType;

    const config: SpanConfig = {
      id: shortId(),
      name: lwSpan.name ?? type,
      type,
      durationMs: duration,
      offsetMs: 0,
      status: lwSpan.error ? "error" : "ok",
      children,
      attributes: {},
      ...(lwSpan.input ? { input: lwSpan.input as SpanConfig["input"] } : {}),
      ...(lwSpan.output
        ? { output: lwSpan.output as SpanConfig["output"] }
        : {}),
      ...(lwSpan.error
        ? {
            exception: {
              message: lwSpan.error.message,
              stackTrace: lwSpan.error.stacktrace,
            },
          }
        : {}),
      ...(type === "llm" && lwSpan.model
        ? {
            llm: {
              requestModel: lwSpan.model,
              temperature: (lwSpan.params?.temperature as number) ?? undefined,
              metrics: lwSpan.metrics
                ? {
                    promptTokens: lwSpan.metrics.prompt_tokens,
                    completionTokens: lwSpan.metrics.completion_tokens,
                    cost: lwSpan.metrics.cost,
                  }
                : undefined,
            },
          }
        : {}),
    };

    return config;
  }

  return {
    id: shortId(),
    name: `Imported: ${trace.trace_id}`,
    description: `Imported from trace ${trace.trace_id}`,
    resourceAttributes: { "service.name": "imported" },
    metadata: {
      userId: trace.metadata?.user_id as string | undefined,
      threadId: trace.metadata?.thread_id as string | undefined,
      customerId: trace.metadata?.customer_id as string | undefined,
    },
    spans: rootSpans.map(buildSpanConfig),
  };
}
