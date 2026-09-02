/**
 * What an invitation IS, as a person sees it — separate from the service that
 * mints, mails and spends one.
 *
 * The status rule is the load-bearing half: EXPIRED is DERIVED from
 * `expiration` rather than stored, so there is no sweeper to run and no row to
 * forget to sweep. A PENDING row past its expiry is expired everywhere this is
 * asked — the landing page, the acceptance, the resend — and a second copy of
 * that comparison is how one of those three starts disagreeing with the other
 * two about whether a link still works.
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
  now: Date = new Date(),
): InviteDisplayStatus {
  if (invite.status === "PENDING" && invite.expiration !== null && invite.expiration <= now) {
    return "EXPIRED";
  }
  return invite.status as InviteDisplayStatus;
}
