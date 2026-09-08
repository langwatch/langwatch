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

/** Count lanes holding money, unpriced cells or reported seats. */
export function summaryAsRead(
  data: SummaryForSampleDecision | undefined,
): { length: number } | null {
  if (data === undefined) return null;
  if (data.unavailableReason !== null) return { length: 0 };
  const laneReported = (lane: {
    amountUsd: number | null;
    cellsWithoutAmount: number;
  }) => lane.amountUsd !== null || lane.cellsWithoutAmount > 0;
  const reported =
    (laneReported(data.billed) ? 1 : 0) +
    (laneReported(data.gateway) ? 1 : 0) +
    (data.seats.status === "reported" && data.seats.pools.length > 0 ? 1 : 0);
  return { length: reported };
}
