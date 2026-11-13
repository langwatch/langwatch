/**
 * The least a billed seat line may be set to: the seats of that kind in use, never fewer.
 * @see specs/licensing/seat-quantity-floor.feature
 */
import {
  type BilledSeatKind,
  SeatQuantityBelowInUseError,
} from "@langwatch/enterprise-billing-contract";

type SeatFloor = Readonly<{
  /** The catalogue price names that bill this kind start with this. */
  pricePrefix: string;
  /** The least the line keeps while no seat of this kind is in use. */
  leastWithNoneInUse: number;
}>;

/** Every billed seat kind and its floor; a new kind fails the type check until it has one. */
export const SEAT_FLOORS: Readonly<Record<BilledSeatKind, SeatFloor>> = {
  full: { pricePrefix: "GROWTH_SEAT_", leastWithNoneInUse: 1 },
  developer: { pricePrefix: "DEVELOPER_SEAT_", leastWithNoneInUse: 0 },
};

/** Refuses a seat count below the seats of its kind in use, before any charge. */
export function assertSeatsCoverUse({
  seat,
  requested,
  inUse,
}: {
  seat: BilledSeatKind;
  requested: number;
  inUse: number;
}): void {
  const minimum = Math.max(SEAT_FLOORS[seat].leastWithNoneInUse, inUse);
  if (requested < minimum) {
    throw new SeatQuantityBelowInUseError({ seat, requested, minimum });
  }
}
