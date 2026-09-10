import type { TraceDerivationSpanReaderRepository } from "../../repositories/read/trace-derivation-span-reader.repository.ts";
import { deriveScenarioRoleMetricsFromSpans } from "../../rules/scenario-role-metrics.rules.ts";
import type { ScenarioRoleMetrics } from "../../rules/scenario-role-metrics.rules.ts";
import { SpanCostService } from "../span/span-cost.service.ts";
import { nowInstant } from "@langwatch/time";

/**
 * Window after which a memo entry is dropped purely as a memory backstop — correctness comes from
 * the fold-version key, not aging. An entry for a superseded version is never read again, so this
 * only bounds how long an unused entry lingers.
 */
const DERIVATION_READ_WINDOW_MS = 30_000;

/** Cap so a burst of distinct traces or versions cannot grow the memo without bound. */
const DERIVATION_MEMO_MAX_ENTRIES = 2_000;

interface MemoEntry {
  value: Promise<ScenarioRoleMetrics>;
  expiresAt: number;
}

export interface ScenarioRoleMetricsDerivationInput {
  tenantId: string;
  traceId: string;
  /**
   * ClickHouse partition hint (the trace's EARLIEST span time). It narrows the
   * partitions scanned; it is NOT a freshness cutoff and does not bound which
   * spans come back, so it must not key the memo.
   */
  occurredAtMs?: number;
  /**
   * Monotonic fold watermark, the fold's spanCount. The memo is keyed on it so a cached derivation
   * is reused only within one fold version and drops the moment newer spans land. Omit it to
   * bypass the memo: a live read with no watermark always hits storage.
   */
  foldVersion?: number;
}

/**
 * Per-role cost and latency for one trace, derived from stored spans rather than accumulated on
 * the hot fold path. The memo is the point: a coalesced batch fires subscribers once per event at
 * one shared final state, so without it the multi-MB read runs once per span in the backlog.
 */
export class ScenarioRoleMetricsDerivationService {
  static create(options: {
    spans: TraceDerivationSpanReaderRepository;
    /**
     * How a span's cost is estimated when it carries none. The static model catalog is correct
     * here, not the operator's per-project overrides: those price a span at record time, and
     * re-pricing a stored span against them would disagree with what was already billed.
     */
    spanCosts: SpanCostService;
    now?: () => number;
  }): ScenarioRoleMetricsDerivationService {
    return new ScenarioRoleMetricsDerivationService(
      options.spans,
      options.spanCosts,
      options.now ?? (() => nowInstant().epochMilliseconds),
    );
  }

  private readonly memo = new Map<string, MemoEntry>();

  private constructor(
    private readonly spans: TraceDerivationSpanReaderRepository,
    private readonly spanCosts: SpanCostService,
    private readonly now: () => number,
  ) {}

  async derive(input: ScenarioRoleMetricsDerivationInput): Promise<ScenarioRoleMetrics> {
    const read = async (): Promise<ScenarioRoleMetrics> =>
      deriveScenarioRoleMetricsFromSpans({
        spans: await this.spans.findNormalizedSpansByTraceId({
          tenantId: input.tenantId,
          traceId: input.traceId,
          ...(input.occurredAtMs === undefined ? {} : { occurredAtMs: input.occurredAtMs }),
        }),
        spanCostService: this.spanCosts,
      });

    if (input.foldVersion === undefined) {
      return read();
    }

    const key = `${input.tenantId}:${input.traceId}:${input.foldVersion}`;
    const now = this.now();
    const cached = this.memo.get(key);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = read();
    this.memo.set(key, { value, expiresAt: now + DERIVATION_READ_WINDOW_MS });
    this.sweep(now);

    return value;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.memo) {
      if (entry.expiresAt <= now) {
        this.memo.delete(key);
      }
    }

    while (this.memo.size > DERIVATION_MEMO_MAX_ENTRIES) {
      const oldest = this.memo.keys().next();
      if (oldest.done) {
        break;
      }

      this.memo.delete(oldest.value);
    }
  }
}
