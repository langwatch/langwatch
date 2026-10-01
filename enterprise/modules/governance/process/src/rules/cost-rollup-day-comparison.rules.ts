// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Port of the pure half of main's `costRollupComparator.service.ts`: what one look at one day sees
 * when governance's own charge record is held against the stored summary. Never a verdict.
 * @see specs/governance/cost-rollup-watch.feature
 */
import type { GovernanceCostChargeRow } from "../repositories/governance-cost-charge.repository.ts";
import type {
  GovernanceCostRollupCellAddress,
  GovernanceCostRollupRow,
} from "../repositories/governance-cost-rollup.repository.ts";
import {
  type CostRollupCellBehind,
  cellsBehindTheirEvents,
} from "./cost-rollup-summary-freshness.rules.ts";
import {
  decodeGovernanceCostRollupKey,
  encodeGovernanceCostRollupKey,
  type GovernanceCostRollupCell,
  isGovernanceCostSource,
} from "./governance-cost-rollup-cell.rules.ts";

/** One cell as the day's charges state it: its money and the newest event moment behind it. */
export interface CostRollupDerivedCell {
  amountNanoMinor: number;
  LastEventOccurredAt: number;
}

export interface CostRollupCellMismatch {
  cell: GovernanceCostRollupCell;
  /** The BILLED amount: a non-dollar row's dollar column is empty and would read as agreement. */
  summarizedNanoMinor: number | null;
  derivedNanoMinor: number | null;
}

export interface CostRollupDayComparison {
  mismatches: CostRollupCellMismatch[];
  behind: CostRollupCellBehind[];
  lagMs: number;
}

/** The fold key a stored row or charge was written under; an unknown lane is a broken record. */
export function keyOfSummarizedRow(row: GovernanceCostRollupCellAddress): string {
  if (!isGovernanceCostSource(row.CostSource)) {
    throw new Error(`Governance cost rollup row names an unknown lane: ${row.CostSource}`);
  }
  return encodeGovernanceCostRollupKey({
    tenantId: row.TenantId,
    day: row.Day,
    costSource: row.CostSource,
    ingestionSourceId: row.IngestionSourceId,
    provider: row.Provider,
    model: row.Model,
    agentId: row.AgentId,
    currencyCode: row.CurrencyCode,
    rawActorId: row.RawActorId,
  });
}

/**
 * Business time on both sides, so an idle lane reads zero instead of climbing with the wall clock.
 * A summary ahead of the newest event is not negative lag.
 */
export function computeCostRollupLagMs({
  latestEventOccurredAtMs,
  latestSummarizedOccurredAtMs,
  windowStartMs,
}: {
  latestEventOccurredAtMs: number | null;
  latestSummarizedOccurredAtMs: number | null;
  windowStartMs: number;
}): number {
  if (latestEventOccurredAtMs === null) return 0;
  const floor = latestSummarizedOccurredAtMs ?? windowStartMs;
  return Math.max(0, latestEventOccurredAtMs - floor);
}

/**
 * The fold's own rule per item, from the charges alone: the newest look stands, a retraction wins
 * a tie with an observation, and of two observations at one moment the first applied stays.
 */
function isLaterLook(
  challenger: GovernanceCostChargeRow,
  holder: GovernanceCostChargeRow,
): boolean {
  if (challenger.ObservedAtMs !== holder.ObservedAtMs) {
    return challenger.ObservedAtMs > holder.ObservedAtMs;
  }
  if (challenger.IsRetraction !== holder.IsRetraction) return challenger.IsRetraction;
  if (challenger.EventOccurredAt !== holder.EventOccurredAt) {
    return challenger.EventOccurredAt < holder.EventOccurredAt;
  }
  return challenger.EventId < holder.EventId;
}

/** Each cell the day's charges describe, with the money its items hold now. */
export function deriveCostRollupCells(
  charges: readonly GovernanceCostChargeRow[],
): Map<string, CostRollupDerivedCell> {
  const items = new Map<string, Map<string, GovernanceCostChargeRow>>();
  const watermarks = new Map<string, number>();
  for (const charge of charges) {
    const key = keyOfSummarizedRow(charge);
    const cellItems = items.get(key) ?? new Map<string, GovernanceCostChargeRow>();
    const holder = cellItems.get(charge.RestatementKey);
    if (holder === undefined || isLaterLook(charge, holder)) {
      cellItems.set(charge.RestatementKey, charge);
    }
    items.set(key, cellItems);
    watermarks.set(key, Math.max(watermarks.get(key) ?? 0, charge.EventOccurredAt));
  }
  const cells = new Map<string, CostRollupDerivedCell>();
  for (const [key, cellItems] of items) {
    cells.set(key, {
      amountNanoMinor: [...cellItems.values()].reduce((sum, item) => sum + item.AmountNanoMinor, 0),
      LastEventOccurredAt: watermarks.get(key) ?? 0,
    });
  }
  return cells;
}

/** Every cell where the two sides state different money, in both directions. */
function collectMismatches({
  derived,
  summarized,
}: {
  derived: ReadonlyMap<string, CostRollupDerivedCell>;
  summarized: ReadonlyMap<string, GovernanceCostRollupRow>;
}): CostRollupCellMismatch[] {
  const unaccounted = new Map(summarized);
  const mismatches: CostRollupCellMismatch[] = [];
  for (const [key, cell] of derived) {
    const derivedNanoMinor = cell.amountNanoMinor;
    // A summarized zero and a missing cell are different faults, so `?? null` would blur them.
    const row = unaccounted.get(key);
    const summarizedNanoMinor = row === undefined ? null : row.AmountNanoMinor;
    if (summarizedNanoMinor !== derivedNanoMinor) {
      mismatches.push({
        cell: decodeGovernanceCostRollupKey(key),
        summarizedNanoMinor,
        derivedNanoMinor,
      });
    }
    unaccounted.delete(key);
  }
  // Money on the summary that no charge explains is the more alarming direction.
  for (const [key, row] of unaccounted) {
    mismatches.push({
      cell: decodeGovernanceCostRollupKey(key),
      summarizedNanoMinor: row.AmountNanoMinor,
      derivedNanoMinor: null,
    });
  }
  return mismatches;
}

export function compareCostRollupDay({
  derived,
  summarizedRows,
  latestEventOccurredAtMs,
  latestSummarizedOccurredAtMs,
  windowStartMs,
}: {
  derived: ReadonlyMap<string, CostRollupDerivedCell>;
  summarizedRows: readonly GovernanceCostRollupRow[];
  latestEventOccurredAtMs: number | null;
  latestSummarizedOccurredAtMs: number | null;
  windowStartMs: number;
}): CostRollupDayComparison {
  const summarized = new Map(summarizedRows.map((row) => [keyOfSummarizedRow(row), row] as const));
  return {
    mismatches: collectMismatches({ derived, summarized }),
    behind: cellsBehindTheirEvents({ derived, summarized }),
    lagMs: computeCostRollupLagMs({
      latestEventOccurredAtMs,
      latestSummarizedOccurredAtMs,
      windowStartMs,
    }),
  };
}
