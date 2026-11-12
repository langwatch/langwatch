/** Who holds a seat and which kind (ADR-002): the vocabulary seat changes and the fold share. */
import { z } from "zod";

/** The seat a holder takes; `none` is no seat at all (not a member, a held arrival, a disable). */
export const seatKindSchema = z.enum(["full", "lite", "developer", "none"]);
export type SeatKind = z.infer<typeof seatKindSchema>;

/**
 * A member holds a seat by its user; a pending invitation holds one until it expires; a seat hold
 * keeps a departed person's full seat until it ends (seat-rotation.feature).
 */
export const seatHolderSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("member"), userId: z.string().min(1) }),
  z.object({
    kind: z.literal("invitation"),
    inviteId: z.string().min(1),
    /** Epoch milliseconds; null for an invitation that never expires. */
    expiresAt: z.number().int().nonnegative().nullable(),
  }),
  z.object({
    kind: z.literal("hold"),
    userId: z.string().min(1),
    /** Epoch milliseconds: the hold's end. */
    expiresAt: z.number().int().nonnegative(),
  }),
]);
export type SeatHolder = z.infer<typeof seatHolderSchema>;

/** The holder's id within its kind: a member's or a hold's user, an invitation's id. */
export function seatHolderId(holder: SeatHolder): string {
  return holder.kind === "invitation" ? holder.inviteId : holder.userId;
}
