import { env } from "~/env.mjs";

/**
 * The link a "confirm this address" email carries, for an address somebody
 * added from their authentication settings.
 *
 * It returns to the page the request came FROM, which is the whole design of
 * D01's ceremony: completion needs the emailed token AND the PKCE verifier
 * the asking browser kept, so the link is only half the proof and the page
 * that started it holds the other half. Opening it anywhere else confirms
 * nothing and says so.
 *
 * Lives outside the mailer for the same reason `signup-verification-link.ts`
 * does: tests mock the mailer to keep real email out of a run, and a pure URL
 * builder stranded inside a mocked module disappears with it.
 */
export function buildAddressConfirmationUrl({
  identifierId,
  verificationId,
  token,
}: {
  identifierId: string;
  verificationId: string;
  token: string;
}): string {
  const params = new URLSearchParams({
    confirm: identifierId,
    verification: verificationId,
    token,
  });
  return `${env.BASE_HOST}/settings/security?${params.toString()}`;
}
