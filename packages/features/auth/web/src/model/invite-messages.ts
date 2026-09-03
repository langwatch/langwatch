/**
 * The one sentence the invitation hook has to recognise rather than render.
 *
 * `platform/app/src/server/invites/errors.ts` declares it server-side and a
 * browser package may not reach `~/server`, so it is restated here — the same
 * shape `@langwatch/data-retention-contract` and the Backoffice enums took,
 * and with the same obligation: the two copies must stay identical, because
 * this is the string an already-accepted invitation is recognised by.
 *
 * It is compared, never shown: an invitation that was already accepted is a
 * success from where the customer is standing, so the hook redirects instead
 * of complaining.
 */
export const INVITE_ALREADY_ACCEPTED_MESSAGE = "Invite was already accepted" as const;
