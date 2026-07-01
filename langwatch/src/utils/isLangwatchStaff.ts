/**
 * Staff predicate used as the bypass for `release_langy_enabled`.
 *
 * Requires BOTH a `@langwatch.ai` email AND `emailVerified === true`. The
 * verification check matters in self-hosted `NEXTAUTH_PROVIDER=email` mode,
 * where signups land with `emailVerified=false` and there is no verification
 * email wired by default — without this gate, anyone running the operator
 * binary could register `attacker@langwatch.ai` and instantly bypass the
 * feature flag. SSO/OAuth providers (Google, Auth0, GitHub, ...) assert
 * verification on the user's behalf, so `emailVerified` is already true
 * before the session is minted.
 */
export function isLangwatchStaff(
  user:
    | {
        email?: string | null;
        emailVerified?: boolean | null;
      }
    | null
    | undefined,
): boolean {
  if (!user?.email) return false;
  if (!user.emailVerified) return false;
  return user.email.trim().toLowerCase().endsWith("@langwatch.ai");
}
