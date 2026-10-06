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
