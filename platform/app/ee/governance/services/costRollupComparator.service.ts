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
import {
  type CostRollupCellBehind,
  cellsBehindTheirEvents,
} from "./logic/costRollupSummaryFreshness";

const logger = createLogger("langwatch:governance:cost-rollup:comparator");

/**
 * The lanes this build compares: the pulled lane, for every tenant.
 *
 * The metered lane is not compared. The cost screen reads it straight off the
 * per-request ledger, and the rollup fold no longer writes gateway cells, so
 * a gateway comparison would re-derive cells the summary is never written
 * with and always find nothing on both sides — a check that could not fail.
 *
 * A tuple so the event-type map below can be typed by it: the compiler then
 * proves the map covers exactly the compared lanes, no more and no fewer.
 */
export const COMPARED_COST_SOURCES = [GOVERNANCE_COST_SOURCE.PULLED] as const;
export type ComparedCostSource = (typeof COMPARED_COST_SOURCES)[number];

/**
 * Which events each compared lane is derived from.
 *
 * Keyed by `ComparedCostSource` rather than by every lane the table knows:
 * the compiler then refuses a lane that is compared but has no events, and a
 * lane with events that is not compared, so the two cannot drift apart. The
 * metered lane is absent on purpose — the summary is never written with its
 * cells, so there is nothing to hold its events against.
 */
export const COST_SOURCE_EVENT_TYPES: Record<
  ComparedCostSource,
  readonly string[]
> = {
  // The retraction is here for the same reason the observation is: the check
  // re-derives a day by folding the events that fall inside it, and a fold
  // that never sees the retraction re-derives the amount the retraction
  // withdrew. The day would then be reported as disagreeing with its own
  // history for as long as it is kept, on every run.
  [GOVERNANCE_COST_SOURCE.PULLED]: [
    "lw.obs.pulled_usage.observed",
    "lw.obs.pulled_usage.retracted",
  ],
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

/**
 * What one comparison saw. An observation, not a verdict.
 *
 * Nothing here is logged or counted by the act of producing it. Whether a
 * disagreement is drift or a summary the fold has not caught up with is not
 * knowable from one look — see `costRollupWatch.process.ts`, which decides it
 * by asking again — so this reports the figures and leaves the judging to the
 * caller that knows how many looks it has left.
 */
export interface CostRollupComparison {
  day: string;
  costSource: ComparedCostSource;
  mismatches: CostRollupCellMismatch[];
  lagMs: number;
  /**
   * Cells whose summary row demonstrably has not folded every charge this
   * comparison re-derived.
   *
   * Evidence, not a gate. Empty does NOT mean the summary is complete — the
   * watermark it rests on is a maximum of provider timestamps, so two charges
   * sharing one timestamp leave it unmoved. A non-empty list is proof of
   * catching-up; an empty one is merely the absence of that proof.
   */
  behind: CostRollupCellBehind[];
}

/**
 * The daily cost rollup's watchdog: re-derives one sampled day straight from
 * the event log and holds it against what the summary says.
 *
 * It does NOT self-heal, and that is the decision rather than an omission. A
 * comparator that quietly rewrote the row it disagreed with would erase the
 * only evidence of why the two ever diverged, and the next divergence would
 * look like the first. So a mismatch is named on a log line and the row is
 * left exactly as it was found.
 *
 * It does not decide, either. Looking is cheap and safe to repeat; declaring
 * drift is neither, and a single look cannot tell drift from a fold that is
 * seconds behind. So `compareDay` only ever reports what it saw, and
 * `reportCostRollupDrift` — the counter and the error line — is left for the
 * caller that knows whether the disagreement has outlived its retries.
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
    costSource: ComparedCostSource;
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
      summarized.map(
        (row) => [governanceCostRollupKeyOfRow(row), row] as const,
      ),
    );

    // Stated on every comparison, including the ones the caller goes on to
    // retry, because the lag is what tells a summary catching up apart from a
    // summary that has stopped — and the retried looks are exactly where an
    // operator needs to see which of the two is happening.
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

    return {
      day,
      costSource,
      mismatches: collectMismatches({
        derived,
        summarized: summarizedByKey,
      }),
      lagMs,
      behind: cellsBehindTheirEvents({
        derived,
        summarized: summarizedByKey,
      }),
    };
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

/**
 * Says, once and for the record, that a comparison's disagreement is real.
 *
 * Separate from `compareDay` because comparing is cheap and repeatable while
 * saying so is neither: this increments the mismatch counter an alert reads
 * and writes the error line an operator is paged on. Only the caller holding
 * the retry ladder knows whether a disagreement has been looked at enough
 * times to deserve that, so only it may call this — see the intent handler in
 * `costRollupWatch.process.ts`. Calling it on every look would count one
 * fold-lag several times over and page on a number that was about to settle.
 *
 * Counts and names every mismatch one cell at a time; a comparison that found
 * none is a no-op, so the caller need not guard it.
 */
export function reportCostRollupDrift({
  tenantId,
  comparison,
}: {
  tenantId: string;
  comparison: CostRollupComparison;
}): void {
  const { day, costSource } = comparison;
  for (const mismatch of comparison.mismatches) {
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
        lag_ms: comparison.lagMs,
        // Present on a line that reports drift because it is the first thing
        // that makes a reader doubt it: a summary still visibly behind here
        // has been behind for the whole ladder, which is a stopped fold
        // wearing drift's clothes.
        cells_behind: comparison.behind.length,
      },
      "Governance cost rollup disagrees with the events it was derived from",
    );
  }
}

/**
 * Every cell where the two sides state different money, in both directions.
 *
 * Pure, and it copies the summary map rather than draining the caller's: the
 * freshness check reads the same map, and a collector that emptied it as it
 * went would silently depend on running last.
 */
function collectMismatches({
  derived,
  summarized,
}: {
  derived: ReadonlyMap<string, GovernanceCostRollupState>;
  summarized: ReadonlyMap<string, GovernanceCostRollupRow>;
}): CostRollupCellMismatch[] {
  const unaccounted = new Map(summarized);
  const mismatches: CostRollupCellMismatch[] = [];
  for (const [key, state] of derived) {
    const derivedAmount = governanceCostRollupTotals(state).amountNanoMinor;
    // `?? null` would read a summarized amount of 0 as absent. A cell whose
    // events sum to zero and a cell that is missing from the summary are
    // different faults, and only one of them is drift.
    const row = unaccounted.get(key);
    const summarizedAmount = row === undefined ? null : row.AmountNanoMinor;
    if (summarizedAmount !== derivedAmount) {
      mismatches.push({
        cell: decodeGovernanceCostRollupKey(key),
        summarizedNanoMinor: summarizedAmount,
        derivedNanoMinor: derivedAmount,
      });
    }
    unaccounted.delete(key);
  }
  // Whatever is left is a summary cell the events do not account for — money
  // on a screen that nothing on the log explains, which is the more alarming
  // direction of the two and must not be the one the watchdog is blind to.
  for (const [key, row] of unaccounted) {
    mismatches.push({
      cell: decodeGovernanceCostRollupKey(key),
      summarizedNanoMinor: row.AmountNanoMinor,
      derivedNanoMinor: null,
    });
  }
  return mismatches;
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

/**
 * The slice of the comparator a caller that only checks a day needs.
 *
 * The comparison comes back rather than being swallowed: the caller has to
 * read the mismatches to decide whether to accept them or look again.
 */
export interface CostRollupComparatorDayComparer {
  compareDay(params: {
    tenantId: string;
    day: string;
    costSource: ComparedCostSource;
  }): Promise<CostRollupComparison>;
}
