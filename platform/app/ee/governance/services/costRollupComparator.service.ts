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

export interface CostRollupComparison {
  day: string;
  costSource: ComparedCostSource;
  mismatches: CostRollupCellMismatch[];
  lagMs: number;
}

/**
 * The day's summary has not folded every charge the day holds yet, so there is
 * nothing honest to compare it against.
 *
 * A refusal to answer rather than an answer of "drift". The fold and the check
 * run on independent queues, so a charge landing shortly before the check's
 * slot can be re-derived here while its own projection job is still queued —
 * and the only thing that fixes that is waiting. Throwing is how this asks to
 * be asked again: the caller is the process manager's outbox, whose retry
 * ladder (`costRollupWatch.process.ts`) is exactly that wait. Returning a
 * comparison instead would publish a false alarm AND clear the day, because a
 * comparison that returns is a comparison that happened.
 *
 * A plain `Error`, not a `HandledError`: nothing here reaches a customer, and
 * dressing an internal wait up as a handled fault would promise a reader an
 * action they do not have. What an operator needs is on the warn line and on
 * the lag gauge, both written before this is raised.
 *
 * If every attempt in the ladder sees the summary still behind, the row dies
 * in the outbox and the day goes uncompared — reported as lag, which is what a
 * projection that stopped folding actually is, rather than as drift.
 */
export class CostRollupSummaryBehindError extends Error {
  readonly tenantId: string;
  readonly day: string;
  readonly costSource: ComparedCostSource;
  readonly cells: readonly CostRollupCellBehind[];
  readonly lagMs: number;

  constructor({
    tenantId,
    day,
    costSource,
    cells,
    lagMs,
  }: {
    tenantId: string;
    day: string;
    costSource: ComparedCostSource;
    cells: readonly CostRollupCellBehind[];
    lagMs: number;
  }) {
    super(
      `Governance cost rollup for ${day} is still catching up: ${cells.length} cell(s) behind the events of that day`,
    );
    this.name = "CostRollupSummaryBehindError";
    this.tenantId = tenantId;
    this.day = day;
    this.costSource = costSource;
    this.cells = cells;
    this.lagMs = lagMs;
  }
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

    // Stated before the check can either refuse or report, because the lag is
    // what an operator reads in both cases: it is the gauge that tells a
    // summary catching up apart from a summary that has stopped.
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

    // Refusing costs one retry; reporting would cost a false alarm AND clear
    // the day, because a comparison that returns is a comparison that happened
    // and nothing marks the day again.
    const behind = cellsBehindTheirEvents({
      derived,
      summarized: summarizedByKey,
    });
    if (behind.length > 0) {
      logger.warn(
        {
          tenantId,
          day,
          cost_source: costSource,
          cells_behind: behind.length,
          lag_ms: lagMs,
          derived_last_event_occurred_at_ms:
            behind[0]?.derivedLastEventOccurredAtMs,
          summarized_last_event_occurred_at_ms:
            behind[0]?.summarizedLastEventOccurredAtMs,
        },
        "Governance cost rollup has not folded every charge of the day being checked; waiting rather than reporting drift",
      );
      throw new CostRollupSummaryBehindError({
        tenantId,
        day,
        costSource,
        cells: behind,
        lagMs,
      });
    }

    const mismatches = collectMismatches({
      derived,
      summarized: summarizedByKey,
    });
    this.report({ tenantId, day, costSource, mismatches });

    return { day, costSource, mismatches, lagMs };
  }

  /** Counts each mismatch and names both figures on a line, one cell at a time. */
  private report({
    tenantId,
    day,
    costSource,
    mismatches,
  }: {
    tenantId: string;
    day: string;
    costSource: ComparedCostSource;
    mismatches: readonly CostRollupCellMismatch[];
  }): void {
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

/** The slice of the comparator a caller that only checks a day needs. */
export interface CostRollupComparatorDayComparer {
  compareDay(params: {
    tenantId: string;
    day: string;
    costSource: ComparedCostSource;
  }): Promise<unknown>;
}
