// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Port of main's `costRollupComparator.service.ts`, reading governance's own charge record where
 * main re-read event_log. @see specs/governance/cost-rollup-watch.feature
 */
import { createLogger, type Logger } from "@langwatch/observability";
import {
  type CounterHandle,
  counter,
  type GaugeHandle,
  gauge,
} from "@langwatch/observability/metrics";
import { Temporal } from "@langwatch/time";

import type { GovernanceCostChargeRepository } from "../repositories/governance-cost-charge.repository.ts";
import type { GovernanceCostRollupRepository } from "../repositories/governance-cost-rollup.repository.ts";
import {
  type CostRollupDayComparison,
  compareCostRollupDay,
  deriveCostRollupCells,
} from "../rules/cost-rollup-day-comparison.rules.ts";
import { GOVERNANCE_COST_SOURCE } from "../rules/governance-cost-rollup-cell.rules.ts";

/**
 * What one look at one day's cost found. `reportDrift` rides on the look,
 * not a day back, since a second call would re-compare and report figures
 * this look never saw.
 */
export interface CostRollupDayLook {
  /** Cells where the summary and the events state different money. */
  mismatchedCells: number;
  /**
   * Cells whose summary row demonstrably has not folded every charge of the
   * day. Non-empty is proof the summary is catching up; empty proves nothing.
   */
  cellsBehind: number;
  /** How far the summary trails the events it is derived from. */
  lagMs: number;
  /**
   * Counts and names this look's disagreement, once and for the record. Only
   * a caller that has spent its whole retry ladder may call it; a look that
   * found no disagreement is a no-op.
   */
  reportDrift(): void;
}

/**
 * One look at one organization's day of pulled charges. It reports what it
 * saw and judges nothing — a summary the fold is seconds behind on and a
 * summary that is wrong are the same picture from one look.
 */
export interface CostRollupDayComparer {
  /**
   * The cost lane this comparer holds a day's charges against. Read by the
   * check so every comparison names its lane without repeating a literal.
   */
  readonly costSource: string;
  compareDay(params: { tenantId: string; day: string }): Promise<CostRollupDayLook>;
}

export const COST_ROLLUP_MISMATCH_METRIC_NAME = "langwatch_governance_cost_rollup_mismatch_total";
export const COST_ROLLUP_LAG_METRIC_NAME = "langwatch_governance_cost_rollup_lag_seconds";

export class CostRollupDayComparerService implements CostRollupDayComparer {
  readonly costSource = GOVERNANCE_COST_SOURCE.PULLED;

  private readonly costRollup: GovernanceCostRollupRepository;
  private readonly costCharges: GovernanceCostChargeRepository;
  private readonly mismatches: CounterHandle;
  private readonly lag: GaugeHandle;
  private readonly logger: Logger;

  private constructor(parts: {
    costRollup: GovernanceCostRollupRepository;
    costCharges: GovernanceCostChargeRepository;
    mismatches: CounterHandle;
    lag: GaugeHandle;
    logger: Logger;
  }) {
    this.costRollup = parts.costRollup;
    this.costCharges = parts.costCharges;
    this.mismatches = parts.mismatches;
    this.lag = parts.lag;
    this.logger = parts.logger;
  }

  static create({
    costRollup,
    costCharges,
    logger = createLogger("langwatch:governance:cost-rollup:comparator"),
  }: {
    costRollup: GovernanceCostRollupRepository;
    costCharges: GovernanceCostChargeRepository;
    logger?: Logger;
  }): CostRollupDayComparerService {
    return new CostRollupDayComparerService({
      costRollup,
      costCharges,
      mismatches: counter({
        name: COST_ROLLUP_MISMATCH_METRIC_NAME,
        description:
          "Days on which the governance cost rollup disagreed with the charges it was derived from",
      }),
      lag: gauge({
        name: COST_ROLLUP_LAG_METRIC_NAME,
        description:
          "Seconds between the newest cost charge and the newest moment the rollup covers",
      }),
      logger,
    });
  }

  async compareDay({
    tenantId,
    day,
  }: {
    tenantId: string;
    day: string;
  }): Promise<CostRollupDayLook> {
    const costSource = this.costSource;
    const [charges, summarizedRows, latestEventOccurredAtMs, latestSummarizedOccurredAtMs] =
      await Promise.all([
        this.costCharges.findChargesForDay({ tenantId, day, costSource }),
        this.costRollup.findCellsForDay({ tenantId, day, costSource }),
        this.costCharges.findLatestChargeOccurredAt({ tenantId, costSource }),
        this.costRollup.findLatestSummarizedOccurredAt({ tenantId, costSource }),
      ]);
    const comparison = compareCostRollupDay({
      derived: deriveCostRollupCells(charges),
      summarizedRows,
      latestEventOccurredAtMs,
      latestSummarizedOccurredAtMs,
      windowStartMs: Temporal.Instant.from(`${day}T00:00:00Z`).epochMilliseconds,
    });
    this.lag.set(comparison.lagMs / 1000, { tenant_id: tenantId, cost_source: costSource });
    return {
      mismatchedCells: comparison.mismatches.length,
      cellsBehind: comparison.behind.length,
      lagMs: comparison.lagMs,
      reportDrift: () => this.reportDrift({ tenantId, day, comparison }),
    };
  }

  /** Main's `reportCostRollupDrift`: one count and one error line per disagreeing cell. */
  private reportDrift({
    tenantId,
    day,
    comparison,
  }: {
    tenantId: string;
    day: string;
    comparison: CostRollupDayComparison;
  }): void {
    for (const mismatch of comparison.mismatches) {
      this.mismatches.inc({ cost_source: this.costSource }, 1);
      this.logger.error(
        {
          tenantId,
          day,
          cost_source: this.costSource,
          provider: mismatch.cell.provider,
          model: mismatch.cell.model,
          raw_actor_id: mismatch.cell.rawActorId,
          currency_code: mismatch.cell.currencyCode,
          summarized_nano_minor: mismatch.summarizedNanoMinor,
          derived_nano_minor: mismatch.derivedNanoMinor,
          lag_ms: comparison.lagMs,
          cells_behind: comparison.behind.length,
        },
        "Governance cost rollup disagrees with the charges it was derived from",
      );
    }
  }
}
