import type { Instant } from "@langwatch/time";

/** How long a full seat stays counted after it was taken (seat-rotation.feature). */
export const SEAT_HOLD_DAYS = 30;

/** Whether a seat whose person stops holding it stays counted, and until when. */
export type SeatHoldOutcome =
  | Readonly<{ kind: "held"; until: Instant }>
  | Readonly<{ kind: "freed" }>;

/** A full seat stays counted until 30 days after it was taken; past that it frees at once. */
export function seatHoldOutcome({
  seatTakenAt,
  now,
}: Readonly<{ seatTakenAt: Instant; now: Instant }>): SeatHoldOutcome {
  const until = seatTakenAt.add({ hours: SEAT_HOLD_DAYS * 24 });
  return until.epochMilliseconds > now.epochMilliseconds
    ? { kind: "held", until }
    : { kind: "freed" };
}
