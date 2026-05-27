import type { NormalizedSpan } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { SpanCostService } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/span-cost.service";
import {
  deriveScenarioRoleMetricsFromSpans,
  type ScenarioRoleMetrics,
} from "~/server/event-sourcing/pipelines/trace-processing/projections/services/scenario-role-metrics.derivation";
import type { DerivedTraceEvent } from "~/server/event-sourcing/pipelines/trace-processing/projections/services/trace-events.derivation";

/** Minimal span reader this service needs (satisfied by SpanStorageService). */
export interface NormalizedSpanReader {
  getNormalizedSpansByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]>;
  getTraceEventsByTraceId(params: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]>;
}

interface DeriveParams {
  tenantId: string;
  traceId: string;
  /**
   * ClickHouse partition hint (the trace's EARLIEST span time). It narrows the
   * partitions scanned; it is NOT a freshness cutoff and does not bound which
   * spans come back, so it must not key the memo.
   */
  occurredAtMs?: number;
  /**
   * Monotonic fold watermark — the fold's `spanCount`, which increments every
   * time a span is folded. The memo is keyed on it so a cached derivation is
   * reused only within one fold version (all of a coalesced batch's per-event
   * reactors observe the same final state, so they share one read) and is
   * dropped the moment newer spans land. Omit it to bypass the memo (a live
   * read with no watermark must always hit storage).
   */
  foldVersion?: number;
}

/**
 * Window after which a memo entry is dropped purely as a memory backstop —
 * correctness comes from the fold-version key, not from aging. An entry for a
 * superseded version is simply never read again, so this only bounds how long
 * an unused entry lingers.
 */
const DERIVATION_READ_WINDOW_MS = 30_000;
/** Cap so a burst of distinct traces/versions can't grow the memo without bound. */
const DERIVATION_MEMO_MAX_ENTRIES = 2_000;

interface MemoEntry<T> {
  value: Promise<T>;
  expiresAt: number;
}

/**
 * Derives trace-summary fields that used to be accumulated on the hot fold
 * path. Moving them here keeps the fold O(1) per span: scenario role
 * cost/latency are computed from stored_spans once, when simulation metrics
 * are needed, instead of being maintained per-span for every trace on the
 * platform. See scenario-role-metrics.derivation.ts for the aggregation logic
 * and its parity with the legacy incremental fold.
 *
 * The all-spans read these derivations issue is multi-MB for large traces. A
 * coalesced fold batch fires its reactors once per event but at one shared
 * final fold state, so without coalescing the same read would run once per
 * span in the backlog — the read-amplification that re-saturated Redis/ClickHouse
 * during a backlog drain. The derivations are memoized per (tenant, trace, fold
 * version) so a batch reads stored spans once regardless of how many reactors or
 * events it dispatches, while a fold that has advanced (new spans) re-reads.
 */
export class TraceReadDerivationService {
  private readonly spanCostService = new SpanCostService();
  private readonly scenarioRoleMetricsMemo = new Map<
    string,
    MemoEntry<ScenarioRoleMetrics>
  >();
  private readonly eventsMemo = new Map<string, MemoEntry<DerivedTraceEvent[]>>();

  constructor(private readonly spans: NormalizedSpanReader) {}

  async deriveScenarioRoleMetrics(
    params: DeriveParams,
  ): Promise<ScenarioRoleMetrics> {
    return this.memoize(this.scenarioRoleMetricsMemo, params, async () => {
      const spans = await this.spans.getNormalizedSpansByTraceId({
        tenantId: params.tenantId,
        traceId: params.traceId,
        occurredAtMs: params.occurredAtMs,
      });
      return deriveScenarioRoleMetricsFromSpans({
        spans,
        spanCostService: this.spanCostService,
      });
    });
  }

  async deriveEvents(params: DeriveParams): Promise<DerivedTraceEvent[]> {
    return this.memoize(this.eventsMemo, params, () =>
      this.spans.getTraceEventsByTraceId({
        tenantId: params.tenantId,
        traceId: params.traceId,
        occurredAtMs: params.occurredAtMs,
      }),
    );
  }

  /**
   * Only memoize when a fold watermark is supplied: the key is the fold's
   * version (spanCount), so a cached read is reused within one fold version and
   * re-issued as soon as the fold advances. Without a watermark the read is
   * non-deterministic over time and is left to pass straight through.
   */
  private memoKey(params: DeriveParams): string | null {
    if (params.foldVersion === undefined) return null;
    return `${params.tenantId}:${params.traceId}:${params.foldVersion}`;
  }

  private memoize<T>(
    cache: Map<string, MemoEntry<T>>,
    params: DeriveParams,
    read: () => Promise<T>,
  ): Promise<T> {
    const key = this.memoKey(params);
    if (key === null) return read();

    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = read();
    // Delete before set so a refreshed (expired) key re-inserts at the end:
    // Map.set on an existing key keeps its original position, which would let
    // eviction drop a just-read entry as the "oldest". Re-inserting keeps the
    // insertion order tracking last read.
    cache.delete(key);
    cache.set(key, { value, expiresAt: now + DERIVATION_READ_WINDOW_MS });
    // Never cache a failed read: drop the entry so the next caller retries
    // instead of replaying the rejection for the whole window.
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    this.evict(cache, now);
    return value;
  }

  private evict<T>(cache: Map<string, MemoEntry<T>>, now: number): void {
    if (cache.size <= DERIVATION_MEMO_MAX_ENTRIES) return;
    for (const [k, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(k);
    }
    // Map preserves insertion order, so the front is the oldest entry.
    while (cache.size > DERIVATION_MEMO_MAX_ENTRIES) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }
}
