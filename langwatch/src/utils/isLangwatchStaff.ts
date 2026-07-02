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
 *
 * In production, Langy is temporarily further restricted to a single
 * allowlisted email while the feature is being hardened (see
 * LANGY_PROD_ALLOWLIST) — non-production environments (dev, staging,
 * self-hosted) keep the full @langwatch.ai staff bypass so the team can
 * keep testing locally.
 */

// Temporary production lockdown while Langy is being hardened. Widen or
// remove once the feature is stable enough for the whole team again.
const LANGY_PROD_ALLOWLIST = new Set(["aryan@langwatch.ai"]);

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
  const email = user.email.trim().toLowerCase();
  if (process.env.NODE_ENV === "production") {
    return LANGY_PROD_ALLOWLIST.has(email);
  }
  return email.endsWith("@langwatch.ai");
}
