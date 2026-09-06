/**
 * What an invitation IS, as a person sees it, separate from the service that mints/mails/spends
 * one. EXPIRED is derived from `expiration` rather than stored, so there's no sweeper to forget.
 */

/** The state an invitation is IN, as a person sees it. */
export type InviteDisplayStatus =
  | "PENDING"
  | "ACCEPTED"
  | "EXPIRED"
  | "REVOKED"
  // Deprecated Postgres enum value (D11 retirement); no row carries it after
  // the data migration, but the column type still names it.
  | "WAITING_APPROVAL"
  | "PAYMENT_PENDING";

export function resolveInviteDisplayStatus(
  invite: { status: string; expiration: Date | null },
  nowMs: number = Date.now(),
): InviteDisplayStatus {
  if (
    invite.status === "PENDING" &&
    invite.expiration !== null &&
    invite.expiration.getTime() <= nowMs
  ) {
    return "EXPIRED";
  }
  return invite.status as InviteDisplayStatus;
}
