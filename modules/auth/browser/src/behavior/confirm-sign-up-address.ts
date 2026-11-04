import {
  signUpVerificationResultSchema,
  type SignUpVerificationResult,
} from "@langwatch/auth-contract";

/** Better Auth's endpoint, not a tRPC call: spending the link may set the first session cookie. */
const SIGN_UP_CONFIRM_ADDRESS_URL = "/api/auth/sign-up/confirm-address";

/**
 * Each link's one spend in this document. The token is single-use, so a screen that mounts
 * again (or asks twice) must read the answer of the spend already made, never a second one
 * that the server refuses for a link that worked.
 */
const spends = new Map<string, Promise<SignUpVerificationResult>>();

/**
 * Spends the emailed sign-up link once per document. A refusal is thrown as its body with the
 * status stamped on, so `readHandledError` lifts the code and a bodiless rate limit still reads
 * as one.
 */
export function confirmSignUpAddress({
  token,
}: {
  token: string;
}): Promise<SignUpVerificationResult> {
  const spent = spends.get(token);
  if (spent) return spent;
  const spend = spendLink({ token });
  spends.set(token, spend);
  // A refusal spent nothing worth keeping, and a dropped request may not have reached the server.
  spend.catch(() => spends.delete(token));
  return spend;
}

/** Forgets every spend; for tests, which share one module across cases. */
export function forgetSignUpLinkSpends(): void {
  spends.clear();
}

async function spendLink({ token }: { token: string }): Promise<SignUpVerificationResult> {
  const response = await fetch(SIGN_UP_CONFIRM_ADDRESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(typeof body === "object" && body !== null ? body : {}, {
      status: response.status,
    });
  }
  return signUpVerificationResultSchema.parse(body);
}
