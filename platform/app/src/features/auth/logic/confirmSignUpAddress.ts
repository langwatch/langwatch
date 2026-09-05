/**
 * Spending the sign-up confirmation link (D13, ADR-117 §6 revised).
 *
 * A plain fetch to the better-auth endpoint rather than a tRPC call, because
 * the answer is partly a COOKIE: a link spent on an account that exists opens
 * that account's first session, and the tRPC boundary has no response to set
 * one on. `credentials: "include"` is what lets the browser keep it.
 *
 * A refusal arrives in the REST body shape the error registry reads — the
 * endpoint answers a handled error the same way a Hono route does — so the
 * body is thrown as-is and `readHandledError` lifts the code off it.
 */
export interface ConfirmedSignUpAddress {
  email: string;
  accountCreated: boolean;
  accountExists: boolean;
  /** The proof `user.register` spends where the address had no account. */
  addressProof: string | null;
  /** Whether this spend opened a session, so the screen can go straight in. */
  signedIn: boolean;
}

export const SIGN_UP_CONFIRM_ADDRESS_URL = "/api/auth/sign-up/confirm-address";

export async function confirmSignUpAddress({
  token,
}: {
  token: string;
}): Promise<ConfirmedSignUpAddress> {
  const response = await fetch(SIGN_UP_CONFIRM_ADDRESS_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    // The status rides along so a rate limit, which better-auth answers with
    // no body of its own, still reads as one.
    throw Object.assign(typeof body === "object" && body !== null ? body : {}, {
      status: response.status,
    });
  }
  return body as ConfirmedSignUpAddress;
}
