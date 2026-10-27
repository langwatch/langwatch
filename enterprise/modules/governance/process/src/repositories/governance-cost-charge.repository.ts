// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Governance's own record of every pulled charge, one row per event, written beside the cost
 * rollup from the same events. The drift check holds the rollup against it, never event_log.
 * @see specs/governance/cost-rollup-watch.feature
 */
import type { AppendStore, BulkAppendContext, ProjectionStoreContext } from "@langwatch/eventing";

import type { GovernanceCostRollupCellAddress } from "./governance-cost-rollup.repository.ts";

export const GOVERNANCE_COST_CHARGE_TABLE = "governance_cost_rollup_charges";

/** One charge event: the rollup cell it lands on, the item it moves and what that item holds. */
export type GovernanceCostChargeRow = GovernanceCostRollupCellAddress & {
  EventId: string;
  RestatementKey: string;
  /** A retraction zeroes its item; an observation states its amount. */
  IsRetraction: boolean;
  ObservedAtMs: number;
  /** The billed amount in the cell's currency; zero on a retraction. */
  AmountNanoMinor: number;
  /** The event's own moment, the same one the rollup's `LastEventOccurredAt` watermark reads. */
  EventOccurredAt: number;
};

/** Written as the map projection's store (as authz-grant-projection.repository.ts:36 is). */
export abstract class GovernanceCostChargeRepository implements AppendStore<GovernanceCostChargeRow> {
  abstract append(row: GovernanceCostChargeRow, context: ProjectionStoreContext): Promise<void>;

  abstract bulkAppend(rows: GovernanceCostChargeRow[], context: BulkAppendContext): Promise<void>;

  /** Every charge dated on one day of one lane, each event once. */
  abstract findChargesForDay(input: {
    tenantId: string;
    day: string;
    costSource: string;
  }): Promise<GovernanceCostChargeRow[]>;

  /** The newest event moment recorded for the lane, or null when it holds no charge. */
  abstract findLatestChargeOccurredAt(input: {
    tenantId: string;
    costSource: string;
  }): Promise<number | null>;
}
