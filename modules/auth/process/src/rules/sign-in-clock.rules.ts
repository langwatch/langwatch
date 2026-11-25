/**
 * How far a sign-in token's times may sit from our clock (ruling: Alex, 2026-10-09).
 * specs/identity/sso-protocol-conditions.feature
 */
export const SIGN_IN_CLOCK_TOLERANCE_SECONDS = 120;

/** The oldest `iat` an ID token is believed with; jose checks `iat` only when this is set. */
export const ID_TOKEN_MAX_AGE_SECONDS = 60 * 60;

/** Whether an ID token was issued within the tolerance of now and is not past its max age. */
export function isIssuedAtWithinTolerance({
  issuedAt,
  nowSeconds,
}: {
  issuedAt: unknown;
  nowSeconds: number;
}): boolean {
  if (typeof issuedAt !== "number") return false;
  const age = nowSeconds - issuedAt;
  return (
    age >= -SIGN_IN_CLOCK_TOLERANCE_SECONDS &&
    age <= ID_TOKEN_MAX_AGE_SECONDS + SIGN_IN_CLOCK_TOLERANCE_SECONDS
  );
}
