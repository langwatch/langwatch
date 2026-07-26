import { type ProjectApi, eventually } from "./api";

/**
 * Trace ingestion helpers.
 *
 * `/api/collector` dispatches into the event-sourcing pipeline and returns
 * immediately — there is no synchronous or test mode on the HTTP path — so
 * anything that reads a trace back has to poll. `ingestTrace` returns as soon
 * as the collector accepts; `waitForTrace` is the "and it landed" half.
 */

export type IngestOptions = {
  /** Defaults to a unique id so concurrent tests never collide. */
  traceId?: string;
  input?: string;
  output?: string;
  userId?: string;
  labels?: string[];
};

export function uniqueTraceId(prefix = "e2e"): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function ingestTrace(
  api: ProjectApi,
  options: IngestOptions = {},
): Promise<string> {
  const traceId = options.traceId ?? uniqueTraceId();
  const startedAt = Date.now();

  await api.post("/api/collector", {
    trace_id: traceId,
    spans: [
      {
        type: "llm",
        span_id: `${traceId}-span-1`,
        trace_id: traceId,
        model: "openai/gpt-5-mini",
        input: {
          type: "chat_messages",
          value: [{ role: "user", content: options.input ?? "hello from e2e" }],
        },
        output: {
          type: "chat_messages",
          value: [
            { role: "assistant", content: options.output ?? "hi from e2e" },
          ],
        },
        metrics: { prompt_tokens: 12, completion_tokens: 4 },
        timestamps: { started_at: startedAt, finished_at: startedAt + 1000 },
      },
    ],
    metadata: {
      ...(options.userId ? { user_id: options.userId } : {}),
      ...(options.labels ? { labels: options.labels } : {}),
    },
  });

  return traceId;
}

/**
 * Polls until the trace is queryable, i.e. the pipeline has projected it.
 */
export async function waitForTrace(
  api: ProjectApi,
  traceId: string,
  { timeoutMs = 90_000 }: { timeoutMs?: number } = {},
): Promise<Record<string, unknown>> {
  return eventually(
    `trace ${traceId} to be queryable`,
    async () => {
      const trace = await api
        .get<Record<string, unknown>>(`/api/traces/${traceId}`)
        .catch(() => undefined);
      return trace ?? undefined;
    },
    { timeoutMs },
  );
}
