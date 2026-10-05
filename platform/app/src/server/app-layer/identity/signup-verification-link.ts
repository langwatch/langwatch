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
   */
  callbackUrl?: string;
}): string {
  const url = `${env.BASE_HOST}/auth/signup?verify=${encodeURIComponent(token)}`;
  const continuation = sameSiteContinuation(callbackUrl);
  return continuation
    ? `${url}&callbackUrl=${encodeURIComponent(continuation)}`
    : url;
}

/**
 * A continuation that stays on this site: an absolute path, not a
 * protocol-relative `//host` and not a scheme. The same test the welcome
 * screen applies to `return_to` before it follows it.
 */
export function sameSiteContinuation(
  callbackUrl: string | undefined,
): string | null {
  if (!callbackUrl) return null;
  if (!callbackUrl.startsWith("/") || callbackUrl.startsWith("//")) return null;
  return callbackUrl;
}
