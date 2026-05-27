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
  occurredAtMs?: number;
}

/**
 * Window during which a derivation for the same (tenant, trace, cutoff) reuses
 * the in-flight or just-resolved span read. A coalesced fold batch dispatches
 * its reactors per event but with one shared final fold state, so every
 * reactor derives at the same occurredAt cutoff back-to-back; this window
 * collapses those identical reads into one. Kept short because the cutoff makes
 * each read deterministic, so the only thing aging out matters for is rare
 * out-of-order late spans.
 */
const DERIVATION_READ_WINDOW_MS = 30_000;
/** Cap so a burst of distinct traces can't grow the memo without bound. */
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
 * occurredAt cutoff, so without coalescing the same read would run once per
 * span in the backlog — the read-amplification that re-saturated Redis/ClickHouse
 * during a backlog drain. The derivations are memoized per (tenant, trace,
 * cutoff) so a batch reads stored spans once regardless of how many reactors or
 * events it dispatches.
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
      const spans = await this.spans.getNormalizedSpansByTraceId(params);
      return deriveScenarioRoleMetricsFromSpans({
        spans,
        spanCostService: this.spanCostService,
      });
    });
  }

  async deriveEvents(params: DeriveParams): Promise<DerivedTraceEvent[]> {
    return this.memoize(this.eventsMemo, params, () =>
      this.spans.getTraceEventsByTraceId(params),
    );
  }

  /**
   * Only deterministic reads are memoized: a derivation with an occurredAt
   * cutoff returns the same spans no matter when it runs, so sharing it across
   * a batch is safe. A live read (no cutoff) is left to pass straight through.
   */
  private memoKey(params: DeriveParams): string | null {
    if (params.occurredAtMs === undefined) return null;
    return `${params.tenantId}:${params.traceId}:${params.occurredAtMs}`;
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
