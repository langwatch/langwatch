import type { TraceDerivationSpanReaderPort } from "../ports/trace-derivation-span-reader.port";
import { deriveScenarioRoleMetricsFromSpans } from "./scenario-role-metrics.rules";
import type { ScenarioRoleMetrics } from "./scenario-role-metrics.rules";
import { SpanCostService } from "./span-cost.service";

/**
 * Window after which a memo entry is dropped purely as a memory backstop —
 * correctness comes from the fold-version key, not from aging. An entry for a
 * superseded version is simply never read again, so this only bounds how long
 * an unused entry lingers.
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
   * Monotonic fold watermark — the fold's `spanCount`, which increments every
   * time a span is folded. The memo is keyed on it so a cached derivation is
   * reused only within one fold version (all of a coalesced batch's per-event
   * subscribers observe the same final state, so they share one read) and is
   * dropped the moment newer spans land. Omit it to bypass the memo: a live
   * read with no watermark must always hit storage.
   */
  foldVersion?: number;
}

/**
 * Per-role cost and latency for one trace, derived from its stored spans.
 *
 * These used to be accumulated on the hot fold path, one addition per span of
 * every trace on the platform. Deriving them here keeps the fold O(1) per span
 * and pays the read once, when a simulation actually needs the numbers.
 *
 * THE MEMO IS THE POINT, not an optimisation. The all-spans read is multi-MB
 * for a large trace, and a coalesced fold batch fires its subscribers once per
 * event at one shared final state — so without it the same read runs once per
 * span in the backlog, which is the read amplification that re-saturated
 * ClickHouse during a drain. Keyed on the fold version, a batch reads once and
 * a fold that has advanced re-reads.
 */
export class ScenarioRoleMetricsDerivationService {
  static create(options: {
    spans: TraceDerivationSpanReaderPort;
    /**
     * How a span's cost is estimated when it carries none. The static model
     * catalog is the correct answer here and the operator's per-project
     * overrides are not: those price a span at RECORD time, and re-pricing a
     * stored span against them would disagree with what was already billed.
     */
    spanCosts: SpanCostService;
    now?: () => number;
  }): ScenarioRoleMetricsDerivationService {
    return new ScenarioRoleMetricsDerivationService(
      options.spans,
      options.spanCosts,
      options.now ?? (() => Date.now()),
    );
  }

  private readonly memo = new Map<string, MemoEntry>();

  private constructor(
    private readonly spans: TraceDerivationSpanReaderPort,
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

    if (input.foldVersion === undefined) return read();

    const key = `${input.tenantId}:${input.traceId}:${input.foldVersion}`;
    const now = this.now();
    const cached = this.memo.get(key);
    if (cached && cached.expiresAt > now) return cached.value;

    const value = read();
    this.memo.set(key, { value, expiresAt: now + DERIVATION_READ_WINDOW_MS });
    this.sweep(now);
    return value;
  }

  private sweep(now: number): void {
    for (const [key, entry] of this.memo) {
      if (entry.expiresAt <= now) this.memo.delete(key);
    }
    while (this.memo.size > DERIVATION_MEMO_MAX_ENTRIES) {
      const oldest = this.memo.keys().next();
      if (oldest.done) break;
      this.memo.delete(oldest.value);
    }
  }
}
