import {
  signUpVerificationResultSchema,
  type SignUpVerificationResult,
} from "@langwatch/auth-contract";

/** Better Auth's endpoint, not a tRPC call: spending the link may set the first session cookie. */
const SIGN_UP_CONFIRM_ADDRESS_URL = "/api/auth/sign-up/confirm-address";

/**
 * Spends the emailed sign-up link. A refusal is thrown as its body with the status stamped
 * on, so `readHandledError` lifts the code and a bodiless rate limit still reads as one.
 */
export async function confirmSignUpAddress({
  token,
}: {
  token: string;
}): Promise<SignUpVerificationResult> {
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
