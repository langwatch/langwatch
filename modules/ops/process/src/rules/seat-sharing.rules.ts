/**
 * The seat sharing check's arithmetic, over epoch milliseconds so no clock is read here.
 * Spec: modules/ops/specs/seat-sharing-check.feature
 */
import {
  SEAT_SHARING_FLAG_RATIO,
  SEAT_SHARING_WINDOW_DAYS,
  type SeatSharingReading,
} from "@langwatch/ops-contract";
import { UNLIMITED } from "@langwatch/plans";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The start of the rolling window the check counts people over. */
export function seatSharingWindowStart(now: number): number {
  return now - SEAT_SHARING_WINDOW_DAYS * DAY_MS;
}

/** Whether a day has passed since the last check, or none has run yet. */
export function isSeatSharingCheckDue({
  at,
  lastCheckedAt,
}: {
  at: number;
  lastCheckedAt: number | null;
}): boolean {
  return lastCheckedAt === null || at - lastCheckedAt >= DAY_MS;
}

/** Whether a plan sells a capped number of seats; uncapped plans use the finite UNLIMITED. */
export function hasCappedSeats(maxMembers: number): boolean {
  return Number.isFinite(maxMembers) && maxMembers < UNLIMITED;
}

/** The people who held a seat in the window, each once. */
export function seatHoldersInWindow({
  fullSeatHolderIds,
  departedIds,
}: {
  fullSeatHolderIds: readonly string[];
  departedIds: readonly string[];
}): string[] {
  return [...new Set([...fullSeatHolderIds, ...departedIds])];
}

/** One organization's reading: flagged when its active people go over twice its seats. */
export function seatSharingReading({
  organizationId,
  planName,
  seats,
  activePeople,
}: Omit<SeatSharingReading, "flagged">): SeatSharingReading {
  return {
    organizationId,
    planName,
    seats,
    activePeople,
    flagged: activePeople > SEAT_SHARING_FLAG_RATIO * seats,
  };
}
