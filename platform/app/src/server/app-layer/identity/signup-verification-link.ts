import { env } from "~/env.mjs";
import { getSafeReturnToPath } from "~/utils/getSafeReturnToPath";

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
export function buildSignUpVerificationUrl({
  token,
  callbackUrl,
}: {
  token: string;
  /**
   * Where the sign-up was going once it is through: `langwatch login`'s
   * device-approval page sends a new account here with itself as the
   * continuation, and the link opens a FRESH tab, so the continuation only
   * survives the hop if the link carries it. A redirect target, so only a
   * path on this site is carried; anything else is dropped, never mailed.
   * Anyone can ask for a sign-up mail to any address, so what is kept here
   * is what a stranger can make LangWatch mail to a victim: the same rule
   * the client applies before it follows a `return_to`.
   */
  callbackUrl?: string;
}): string {
  const url = `${env.BASE_HOST}/auth/signup?verify=${encodeURIComponent(token)}`;
  const continuation = getSafeReturnToPath(callbackUrl);
  return continuation
    ? `${url}&callbackUrl=${encodeURIComponent(continuation)}`
    : url;
}
