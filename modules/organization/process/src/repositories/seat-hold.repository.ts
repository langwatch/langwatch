import type { Instant } from "@langwatch/time";
import { z } from "zod";

/** Why a full seat stopped being held by the person who took it. */
export const seatHoldReasonSchema = z.enum(["REMOVED", "DISABLED", "DEMOTED"]);
export type SeatHoldReason = z.infer<typeof seatHoldReasonSchema>;

/**
 * A full seat still counted after its person stopped holding it, until `heldUntil`
 * (specs/licensing/seat-rotation.feature). One per organization and person.
 */
export type SeatHold = Readonly<{
  organizationId: string;
  userId: string;
  email: string | null;
  name: string | null;
  seatTakenAt: Instant;
  heldUntil: Instant;
  reason: SeatHoldReason;
}>;

/**
 * What a membership write does to its person's full seat. `taken` starts or takes back a seat
 * (any hold for the person goes); `released` stops holding one, leaving `hold` when it is kept;
 * `unchanged` leaves the seat as it stands (the person held no full seat).
 */
export type SeatTransition =
  | Readonly<{ kind: "taken"; since: Instant }>
  | Readonly<{ kind: "released"; hold: SeatHold | null }>
  | Readonly<{ kind: "unchanged" }>;

/** The seat holds an organization keeps; written by the membership writes they come from. */
export abstract class SeatHoldRepository {
  /**
   * The person's holds that have not ended at `now`: the one matching the user id first, then
   * any matching the address. At most one each, as a hold is one per organization and person.
   */
  abstract findLiveForPerson(input: {
    organizationId: string;
    userId?: string;
    email?: string;
    now: Instant;
  }): Promise<SeatHold[]>;

  /** Every hold in the organization that has not ended at `now`, ending soonest first. */
  abstract findLiveInOrganization(input: {
    organizationId: string;
    now: Instant;
  }): Promise<SeatHold[]>;

  /** The organizations with a hold ended at `now`, each one a seat may have freed in. */
  abstract findOrganizationsWithEnded(input: { now: Instant }): Promise<string[]>;

  /** Deletes the organization's holds ended at `now`. */
  abstract deleteEnded(input: { organizationId: string; now: Instant }): Promise<void>;
}
