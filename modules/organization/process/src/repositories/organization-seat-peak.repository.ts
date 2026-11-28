import type { SeatHolder } from "../rules/seat-holder.rules.ts";
import type { SeatPeakState } from "../rules/seat-peak.rules.ts";

/**
 * Which part of an organization's stored count to load (ADR-002 §2). Pending invitations holding
 * a seat that expire before `dueBefore`, or before the latest change folded, always load.
 */
export type SeatPeakSlice = Readonly<{
  organizationId: string;
  /** The holders named, or every holder that holds a seat. */
  holders: readonly SeatHolder[] | "seated";
  dueBefore: number;
}>;

/**
 * The seat peak's rows (ADR-002 §2): one counts row per organization, one row per holder and one
 * per touched month. A fold loads only the slice its fact needs and writes back only what moved.
 */
export abstract class OrganizationSeatPeakRepository {
  /**
   * The slice as stored; before the organization's snapshot, the empty state, whose `openedAt`
   * is null (counting has not started).
   */
  abstract getState(slice: SeatPeakSlice): Promise<SeatPeakState>;

  /**
   * Loads the slice, applies the pure `fold` and writes the rows it moved, one organization at a
   * time, so two folds of one organization never interleave.
   */
  abstract update(
    slice: SeatPeakSlice,
    fold: (state: SeatPeakState) => SeatPeakState,
  ): Promise<void>;
}
