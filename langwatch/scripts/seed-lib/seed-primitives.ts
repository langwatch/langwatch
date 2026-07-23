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
 * than this are simply not ingested — the event-sourced lifecycles still
 * carry the deep history.
 */
export const TRACE_WINDOW_DAYS = 30;

export interface CollectorTarget {
  endpoint: string;
  apiKey: string;
}

/** Ingest one two-span (agent + llm) trace through the real collector. */
export async function ingestTrace(
  target: CollectorTarget,
  trace: TraceFixture,
  fallbackFinishedAt: number,
): Promise<void> {
  const finishedAt = trace.finishedAtMs ?? fallbackFinishedAt;
  const startedAt = finishedAt - trace.latencyMs;
  const response = await fetch(`${target.endpoint}/api/collector`, {
    method: "POST",
    headers: {
      "X-Auth-Token": target.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
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
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(
      `collector rejected ${trace.traceId}: ${response.status} ${await response.text()}`,
    );
  }
}
