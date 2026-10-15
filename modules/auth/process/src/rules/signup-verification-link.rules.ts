import { isSafeReturnToPath } from "@langwatch/auth-contract";

/**
 * The link a sign-up confirmation mail carries. The continuation survives the fresh tab the link
 * opens only if the link carries it; anyone can ask for a sign-up mail to any address, so only a
 * path on this site is carried (specs/members/developer-seat.feature).
 */
export function buildSignUpVerificationUrl({
  baseUrl,
  token,
  callbackUrl,
}: {
  baseUrl: string;
  token: string;
  callbackUrl?: string;
}): string {
  const url = `${baseUrl}/auth/signup?verify=${encodeURIComponent(token)}`;
  return isSafeReturnToPath(callbackUrl)
    ? `${url}&callbackUrl=${encodeURIComponent(callbackUrl)}`
    : url;
}
