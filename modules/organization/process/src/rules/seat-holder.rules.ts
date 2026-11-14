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

/**
 * The live holds a full invitation to their person's address stands in for, each with that
 * invitation: no seat now, the seat again when the invitation expires (ADR-002).
 */
export function suppressedHoldings({
  holds,
  fullUserIds,
  fullInvitations,
}: {
  holds: readonly Readonly<{ userId: string; email?: string | null; expiresAt: number }>[];
  fullUserIds: ReadonlySet<string>;
  fullInvitations: readonly Readonly<{ id: string; email: string }>[];
}): { holder: SeatHolder; seat: SeatKind; suppressedBy: string }[] {
  return holds.flatMap(({ userId, email, expiresAt }) => {
    if (fullUserIds.has(userId) || !email) return [];
    const address = email.toLowerCase();
    const invitation = fullInvitations.find((each) => each.email.toLowerCase() === address);
    if (invitation === undefined) return [];
    return [
      { holder: { kind: "hold", userId, expiresAt }, seat: "none", suppressedBy: invitation.id },
    ];
  });
}
