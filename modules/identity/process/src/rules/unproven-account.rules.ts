/**
 * An account nobody has proven: never confirmed and never signed into. It may hold a password
 * somebody else chose, so the identifier backfill never finalizes it and a confirmation link
 * adopts it (Alex, 2026-10-06, "Adopt gap"). The same test as user's adoption.
 */
export function isUnprovenAccount({
  emailVerified,
  lastLoginAtMs,
}: {
  emailVerified: boolean;
  lastLoginAtMs: number | null;
}): boolean {
  return !emailVerified && lastLoginAtMs === null;
}

/**
 * The adopt gap only matters while a sign-in method set before the proof is there to wipe: a
 * password, a social link, a passkey or a passkey sign-up in flight. An unproven account with
 * none of them is finalized and stays unverified (Alex, 2026-10-11).
 */
export function carriesPreProofSignInMethod({
  accounts,
  passkeys,
  passkeySignupPending,
}: {
  accounts: number;
  passkeys: number;
  passkeySignupPending: boolean;
}): boolean {
  return accounts > 0 || passkeys > 0 || passkeySignupPending;
}
