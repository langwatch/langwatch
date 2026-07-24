/**
 * Shared primitives for the local seeders (seed-realistic-platform-data,
 * seed-mass): the locality guard, the deterministic PRNG, day helpers, the
 * TraceFixture shape, and collector ingestion. Pure utilities only — the
 * seeders own their own stories.
 */

export interface TraceFixture {
  traceId: string;
  userId: string;
  threadId: string;
  input: string;
  output: string;
  model: string;
  latencyMs: number;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  metadata: Record<string, string | string[]>;
  finishedAtMs?: number;
  hasError?: boolean;
}

export function assertLocalUrl(name: string, value: string | undefined): void {
  if (!value) throw new Error(`${name} is required`);
  const hostname = new URL(value).hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase();
  if (
    hostname !== "localhost" &&
    hostname !== "127.0.0.1" &&
    hostname !== "::1" &&
    !hostname.endsWith(".localhost")
  ) {
    throw new Error(`Refusing to seed: ${name} host ${hostname} is not local`);
  }
}

/** Small deterministic PRNG: random-looking local history, stable on reseed. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function utcDayStart(epochMs: number): number {
  const date = new Date(epochMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function dateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

export const DAY_MS = 24 * 60 * 60_000;

/**
 * The collector refuses spans more than 31 days in the past
 * (SPAN_MAX_PAST_MS in trace-request-collection.service.ts) to protect
 * ClickHouse partition pruning. Seeders keep a day of margin: traces older
 * than this go through the pipeline's recordSpan command seam instead of the
 * collector, so the public guard stays intact.
 */
export const TRACE_WINDOW_DAYS = 30;

export interface CollectorTarget {
  endpoint: string;
  apiKey: string;
}

export interface CollectorPayload {
  trace_id: string;
  spans: Array<Record<string, unknown> & { timestamps: { started_at: number } }>;
  metadata: Record<string, string | string[]>;
}

/**
 * The two-span (agent + llm) collector payload for one trace fixture. Shared
 * by the HTTP collector path and the mass seeder's deep-history path, which
 * dispatches the same spans as pipeline commands when the collector's ingest
 * window has passed.
 */
export function buildCollectorPayload(
  trace: TraceFixture,
  fallbackFinishedAt: number,
): CollectorPayload {
  const finishedAt = trace.finishedAtMs ?? fallbackFinishedAt;
  const startedAt = finishedAt - trace.latencyMs;
  return {
    trace_id: trace.traceId,
    spans: [
      {
        trace_id: trace.traceId,
        span_id: `${trace.traceId}-agent`,
        type: "agent",
        name: "support-agent",
        input: { type: "text", value: trace.input },
        output: { type: "text", value: trace.output },
        timestamps: { started_at: startedAt, finished_at: finishedAt },
      },
      {
        trace_id: trace.traceId,
        span_id: `${trace.traceId}-llm`,
        parent_id: `${trace.traceId}-agent`,
        type: "llm",
        name: "chat-completion",
        model: trace.model,
        vendor: "openai",
        input: {
          type: "chat_messages",
          value: [{ role: "user", content: trace.input }],
        },
        output: {
          type: "chat_messages",
          value: [{ role: "assistant", content: trace.output }],
        },
        metrics: {
          prompt_tokens: trace.promptTokens,
          completion_tokens: trace.completionTokens,
          cost: trace.cost,
        },
        timestamps: {
          started_at: startedAt + 80,
          first_token_at: startedAt + Math.round(trace.latencyMs * 0.28),
          finished_at: finishedAt,
        },
      },
    ],
    metadata: {
      user_id: trace.userId,
      thread_id: trace.threadId,
      ...trace.metadata,
    },
  };
}

/** Ingest one two-span (agent + llm) trace through the real collector. */
export async function ingestTrace(
  target: CollectorTarget,
  trace: TraceFixture,
  fallbackFinishedAt: number,
): Promise<void> {
  const response = await fetch(`${target.endpoint}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": target.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildCollectorPayload(trace, fallbackFinishedAt)),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `collector rejected ${trace.traceId}: ${response.status} ${await response.text()}`,
    );
  }
}

/**
 * Ingest one OTLP/JSON metrics export through the real endpoint. The metrics
 * pipeline has no ingest-age guard (unlike spans), so backdated series go
 * through the production boundary as-is. A partialSuccess reply means points
 * were rejected for good — surface it as a failure so a seed never half-lands.
 */
export async function ingestOtlpMetrics(
  target: CollectorTarget,
  request: unknown,
): Promise<void> {
  const response = await fetch(`${target.endpoint}/api/otel/v1/metrics`, {
    method: "POST",
    headers: {
      "X-Auth-Token": target.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `metrics endpoint rejected the batch: ${response.status} ${await response.text()}`,
    );
  }
  const body = (await response.json()) as {
    partialSuccess?: { rejectedDataPoints?: number; errorMessage?: string };
  };
  if (body.partialSuccess?.rejectedDataPoints) {
    throw new Error(
      `metrics endpoint rejected ${body.partialSuccess.rejectedDataPoints} point(s): ${body.partialSuccess.errorMessage ?? "no message"}`,
    );
  }
}
