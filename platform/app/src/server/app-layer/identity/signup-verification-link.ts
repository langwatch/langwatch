import { env } from "~/env.mjs";

/**
 * The link a sign-up confirmation email carries. It returns to the sign-up
 * screen, which spends the token and carries on from the step it left off at
 * — the address is confirmed, so the next question is which sign-in method to
 * hold.
 *
 * Lives outside the mailer for the same reason `invite-link.ts` does: tests
 * mock the mailer to keep real email out of a run, and a pure URL builder
 * stranded inside a mocked module disappears with it.
 */
export function buildSignUpVerificationUrl(token: string): string {
  return `${env.BASE_HOST}/auth/signup?verify=${encodeURIComponent(token)}`;
}
