/** Classify real cost reads for their loading, empty and permission states. */
import type { GovernanceCostSummaryDto } from "@ee/governance/services/governanceCost.service";

/**
 * What the real-data check reads off the headline summary — derived from the
 * DTO rather than transcribed, so a renamed field or a restructured seats
 * union breaks this file at compile time instead of silently never counting.
 */
export type SummaryForSampleDecision = Pick<
  GovernanceCostSummaryDto,
  "unavailableReason" | "billed" | "gateway" | "seats"
>;

/** Whether the server declined the read for this account. */
export function isRefusedRead(
  error: { data?: { code?: string | null } | null } | null | undefined,
): boolean {
  const code = error?.data?.code;
  return code === "FORBIDDEN" || code === "UNAUTHORIZED";
}

/**
 * Count lanes holding money, unpriced cells, a total in any currency, or
 * reported seats.
 *
 * A lane billed ONLY in a currency nobody converted has a null dollar figure
 * and no unpriced cell at all — every cell holds an amount, in euros — so the
 * first two tests both say "nothing". The currency totals are the third way a
 * lane reports, and the one this used to miss: a real euro bill read as no
 * bill, and the screen fell back to invented figures over the top of it.
 */
export function summaryAsRead(
  data: SummaryForSampleDecision | undefined,
): { length: number } | null {
  if (data === undefined) return null;
  if (data.unavailableReason !== null) return { length: 0 };
  const laneReported = (lane: {
    amountUsd: number | null;
    cellsWithoutAmount: number;
    currencyTotals: readonly unknown[];
  }) =>
    lane.amountUsd !== null ||
    lane.cellsWithoutAmount > 0 ||
    lane.currencyTotals.length > 0;
  const reported =
    (laneReported(data.billed) ? 1 : 0) +
    (laneReported(data.gateway) ? 1 : 0) +
    (data.seats.status === "reported" && data.seats.pools.length > 0 ? 1 : 0);
  return { length: reported };
}
