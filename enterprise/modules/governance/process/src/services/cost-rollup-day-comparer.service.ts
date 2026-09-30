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

import type { CostRollupDayComparer, CostRollupDayLook } from "../app/governance.members.ts";
import type { GovernanceCostChargeRepository } from "../repositories/governance-cost-charge.repository.ts";
import {
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostRollupRepository,
} from "../repositories/governance-cost-rollup.repository.ts";
import {
  type CostRollupDayComparison,
  compareCostRollupDay,
  deriveCostRollupCells,
} from "../rules/cost-rollup-day-comparison.rules.ts";

export const COST_ROLLUP_MISMATCH_METRIC_NAME = "langwatch_governance_cost_rollup_mismatch_total";
export const COST_ROLLUP_LAG_METRIC_NAME = "langwatch_governance_cost_rollup_lag_seconds";

export class CostRollupDayComparerService implements CostRollupDayComparer {
  readonly costSource = GOVERNANCE_COST_SOURCE.PULLED;

  private constructor(
    private readonly costRollup: GovernanceCostRollupRepository,
    private readonly costCharges: GovernanceCostChargeRepository,
    private readonly mismatches: CounterHandle,
    private readonly lag: GaugeHandle,
    private readonly logger: Logger,
  ) {}

  static create({
    costRollup,
    costCharges,
    logger = createLogger("langwatch:governance:cost-rollup:comparator"),
  }: {
    costRollup: GovernanceCostRollupRepository;
    costCharges: GovernanceCostChargeRepository;
    logger?: Logger;
  }): CostRollupDayComparerService {
    return new CostRollupDayComparerService(
      costRollup,
      costCharges,
      counter({
        name: COST_ROLLUP_MISMATCH_METRIC_NAME,
        description:
          "Days on which the governance cost rollup disagreed with the charges it was derived from",
      }),
      gauge({
        name: COST_ROLLUP_LAG_METRIC_NAME,
        description:
          "Seconds between the newest cost charge and the newest moment the rollup covers",
      }),
      logger,
    );
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
