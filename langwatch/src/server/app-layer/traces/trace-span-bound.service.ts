import type IORedis from "ioredis";
import type { Cluster } from "ioredis";

import { createLogger } from "~/utils/logger/server";
import { STALE_TRACE_THRESHOLD_MS } from "../../event-sourcing/pipelines/trace-processing/schemas/constants";

/**
 * Hard ceiling on how many spans a single trace_id may accrue. Sized far above
 * any legitimate trace (real traces run a handful of spans; the 2026-05-28
 * incident trace reached ~26k) so only pathological reuse / instrumentation
 * loops hit it. See specs/trace-processing/spans-per-trace-bound.feature.
 */
export const DEFAULT_MAX_SPANS_PER_TRACE = 10_000;

/**
 * Reads the per-trace span ingestion ceiling. Mirrors readTenantCap: an unset,
 * empty, or invalid value falls back to the default; 0 disables the bound
 * entirely (operator kill switch).
 */
export function readMaxSpansPerTrace(): number {
  const raw = process.env.LANGWATCH_MAX_SPANS_PER_TRACE;
  if (raw === undefined || raw === "") return DEFAULT_MAX_SPANS_PER_TRACE;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_MAX_SPANS_PER_TRACE;
  return n;
}

// Atomic INCR + sliding EXPIRE in one round-trip. Sliding means a trace that
// keeps accruing spans keeps its counter alive (so it stays bounded across days
// of slow reuse), while a trace idle past the TTL lets its counter expire and
// resets — the TTL is anchored to the pipeline's own trace-liveness window
// (STALE_TRACE_THRESHOLD_MS). Doing both in one script closes the INCR-without-
// TTL window that would otherwise strand a key with no expiry.
const INCR_SLIDING_LUA = `
local count = redis.call("INCR", KEYS[1])
redis.call("EXPIRE", KEYS[1], ARGV[1])
return count
`;

export interface TraceSpanBoundOptions {
  redis: IORedis | Cluster;
  maxSpansPerTrace?: number;
  ttlSeconds?: number;
  keyPrefix?: string;
  logger?: ReturnType<typeof createLogger>;
}

/**
 * Enforces the per-trace span ceiling at the ingestion boundary. A synchronous
 * Redis counter is the authoritative signal: the fold's spanCount lags under the
 * exact burst this defends against, so gating on it would let the burst through.
 */
export class TraceSpanBoundService {
  private readonly redis: IORedis | Cluster;
  private readonly maxSpansPerTrace: number;
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private readonly logger: ReturnType<typeof createLogger>;

  constructor(options: TraceSpanBoundOptions) {
    this.redis = options.redis;
    this.maxSpansPerTrace =
      options.maxSpansPerTrace ?? readMaxSpansPerTrace();
    this.ttlSeconds =
      options.ttlSeconds ?? Math.ceil(STALE_TRACE_THRESHOLD_MS / 1000);
    this.keyPrefix = options.keyPrefix ?? "trace_spans:";
    this.logger =
      options.logger ?? createLogger("langwatch:trace-processing:span-bound");
  }

  private key(tenantId: string, traceId: string): string {
    return `${this.keyPrefix}${tenantId}:${traceId}`;
  }

  /**
   * Admit one span against its trace's ingestion ceiling. Returns true when the
   * span is within the bound, false when the trace has reached the ceiling and
   * the span must be dropped — a front-drop, so the caller skips staging the
   * recordSpan command entirely (bounding all downstream storage + fold cost).
   *
   * Counts delivery attempts, so call this AFTER dedup where dedup exists (the
   * OTLP path) to keep retries from inflating the count. On the collector path
   * (no pre-dispatch dedup) a retry can over-count slightly, which only trips
   * the ceiling marginally earlier — acceptable for an infra-protection bound.
   */
  async admit(tenantId: string, traceId: string): Promise<boolean> {
    if (this.maxSpansPerTrace <= 0) return true; // disabled (kill switch)

    const count = (await this.redis.eval(
      INCR_SLIDING_LUA,
      1,
      this.key(tenantId, traceId),
      String(this.ttlSeconds),
    )) as number;

    if (count > this.maxSpansPerTrace) {
      // Log only when first crossing the bound, not once per dropped span.
      if (count === this.maxSpansPerTrace + 1) {
        this.logger.warn(
          { tenantId, traceId, maxSpansPerTrace: this.maxSpansPerTrace },
          "Trace reached span ingestion bound; dropping further spans for this trace",
        );
      }
      return false;
    }

    return true;
  }
}
