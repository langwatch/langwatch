// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { createLogger } from "@langwatch/observability";
import {
  incrementGovernanceCostRollupMismatch,
  setGovernanceCostRollupLagSeconds,
} from "~/server/metrics";

import {
  GOVERNANCE_COST_SOURCE,
  type GovernanceCostSource,
} from "../projections/governanceCostRollup.constants";
import {
  decodeGovernanceCostRollupKey,
  encodeGovernanceCostRollupKey,
  type GovernanceCostRollupCell,
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
  governanceCostRollupTotals,
} from "../projections/governanceCostRollup.foldProjection";
import type {
  GovernanceCostRollupClickHouseRepository,
  GovernanceCostRollupRow,
} from "./governanceCostRollup.clickhouse.repository";
import { computeCostRollupLagMs } from "./logic/costRollupLag";

const logger = createLogger("langwatch:governance:cost-rollup:comparator");

/** The scheduler consumer key for the comparator's calendar entry. */
export const COST_ROLLUP_COMPARATOR_TARGET_TYPE =
  "governanceCostRollupComparator" as const;

/** Which events each lane is derived from. */
export const COST_SOURCE_EVENT_TYPES: Record<
  GovernanceCostSource,
  readonly string[]
> = {
  [GOVERNANCE_COST_SOURCE.GATEWAY]: [
    "lw.gateway.spend.confirmed",
    "lw.gateway.spend.failed",
  ],
  [GOVERNANCE_COST_SOURCE.PULLED]: ["lw.obs.pulled_usage.observed"],
};

export interface CostRollupCellMismatch {
  cell: GovernanceCostRollupCell;
  /**
   * What the summary says, in the cell's own currency, or null when the
   * summary has no such cell.
   *
   * The BILLED amount rather than the dollar one. On a non-dollar row the
   * dollar column is empty by design, so comparing it makes both sides read as
   * absent and agree with each other while the real amounts differ by any
   * margin at all — the watchdog would be blind exactly where nothing else is
   * watching. Every row has an amount in the currency it was billed in, and
   * the currency is part of the cell, so like is compared with like.
   */
  summarizedNanoMinor: number | null;
  /** What the events add up to, or null when the events have no such cell. */
  derivedNanoMinor: number | null;
}

export interface CostRollupComparison {
  day: string;
  costSource: GovernanceCostSource;
  mismatches: CostRollupCellMismatch[];
  lagMs: number;
}

/**
 * The daily cost rollup's watchdog: re-derives one sampled day straight from
 * the event log and holds it against what the summary says.
 *
 * It does NOT self-heal, and that is the decision rather than an omission. A
 * comparator that quietly rewrote the row it disagreed with would erase the
 * only evidence of why the two ever diverged, and the next divergence would
 * look like the first. So a mismatch increments a counter, names both figures
 * on a log line, and leaves the row exactly as it found it.
 *
 * It reads both sides through the SAME repository the fold writes with, so the
 * watchdog cannot be right about a read the product does differently.
 */
export class CostRollupComparatorService {
  constructor(
    private readonly repo: GovernanceCostRollupClickHouseRepository,
  ) {}

  async compareDay({
    tenantId,
    day,
    costSource,
  }: {
    tenantId: string;
    day: string;
    costSource: GovernanceCostSource;
  }): Promise<CostRollupComparison> {
    const eventTypes = COST_SOURCE_EVENT_TYPES[costSource];

    const [events, summarized, latestEventOccurredAtMs, latestSummarizedMs] =
      await Promise.all([
        this.repo.findCostEventsForDay({ tenantId, day, eventTypes }),
        this.repo.findCellsForDay({ tenantId, day, costSource }),
        this.repo.findLatestEventOccurredAt({ tenantId, eventTypes }),
        this.repo.findLatestSummarizedOccurredAt({ tenantId, costSource }),
      ]);

    const derived = this.refold(events);
    const summarizedByKey = new Map(
      summarized.map((row) => [
        governanceCostRollupKeyOfRow(row),
        row.AmountNanoMinor,
      ]),
    );

    const mismatches: CostRollupCellMismatch[] = [];
    for (const [key, state] of derived) {
      const derivedAmount = governanceCostRollupTotals(state).amountNanoMinor;
      // `?? null` would read a summarized amount of 0 as absent. A cell whose
      // events sum to zero and a cell that is missing from the summary are
      // different faults, and only one of them is drift.
      const summarizedAmount = summarizedByKey.has(key)
        ? summarizedByKey.get(key)!
        : null;
      if (summarizedAmount !== derivedAmount) {
        mismatches.push({
          cell: decodeGovernanceCostRollupKey(key),
          summarizedNanoMinor: summarizedAmount,
          derivedNanoMinor: derivedAmount,
        });
      }
      summarizedByKey.delete(key);
    }
    // Whatever is left is a summary cell the events do not account for — money
    // on a screen that nothing on the log explains, which is the more alarming
    // direction of the two and must not be the one the watchdog is blind to.
    for (const [key, summarizedAmount] of summarizedByKey) {
      mismatches.push({
        cell: decodeGovernanceCostRollupKey(key),
        summarizedNanoMinor: summarizedAmount,
        derivedNanoMinor: null,
      });
    }

    const lagMs = computeCostRollupLagMs({
      latestEventOccurredAtMs,
      latestSummarizedOccurredAtMs: latestSummarizedMs,
      windowStartMs: Date.parse(`${day}T00:00:00.000Z`),
    });
    setGovernanceCostRollupLagSeconds({
      tenantId,
      costSource,
      seconds: lagMs / 1000,
    });

    for (const mismatch of mismatches) {
      incrementGovernanceCostRollupMismatch(costSource);
      logger.error(
        {
          tenantId,
          day,
          cost_source: costSource,
          provider: mismatch.cell.provider,
          model: mismatch.cell.model,
          raw_actor_id: mismatch.cell.rawActorId,
          // The currency is on the line because the two amounts below are in
          // it, and a figure without its denomination is not a figure.
          currency_code: mismatch.cell.currencyCode,
          summarized_nano_minor: mismatch.summarizedNanoMinor,
          derived_nano_minor: mismatch.derivedNanoMinor,
        },
        "Governance cost rollup disagrees with the events it was derived from",
      );
    }

    return { day, costSource, mismatches, lagMs };
  }

  /**
   * Replays the day's events through the very projection that wrote the
   * summary. Using a second implementation here would let the two agree while
   * both were wrong, and disagree whenever one was merely refactored.
   */
  private refold(
    events: Array<{
      type: string;
      tenantId: string;
      occurredAt: number;
      data: Record<string, unknown>;
    }>,
  ): Map<string, GovernanceCostRollupState> {
    const projection = new GovernanceCostRollupFoldProjection({
      store: { store: async () => undefined, get: async () => null },
    });
    const cells = new Map<string, GovernanceCostRollupState>();
    for (const event of events) {
      const key = governanceCostRollupKey(event);
      const state = cells.get(key) ?? projection.init();
      cells.set(key, projection.apply(state, event as never));
    }
    return cells;
  }
}

/** The fold key a stored row would have been written under. */
function governanceCostRollupKeyOfRow(row: GovernanceCostRollupRow): string {
  return encodeGovernanceCostRollupKey({
    tenantId: row.TenantId,
    day: row.Day,
    costSource: row.CostSource as GovernanceCostSource,
    ingestionSourceId: row.IngestionSourceId,
    provider: row.Provider,
    model: row.Model,
    agentId: row.AgentId,
    currencyCode: row.CurrencyCode,
    rawActorId: row.RawActorId,
  });
}
