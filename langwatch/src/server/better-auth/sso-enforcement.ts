import { APIError } from "better-auth/api";

/**
 * Dependencies injected into checkSsoEnforcement so the function is
 * fully unit-testable without a real database or BetterAuth instance.
 */
export interface SsoEnforcementDeps {
  /** Find an org whose ssoDomain (legacy field) matches the given domain */
  findOrgByDomain(domain: string): Promise<{ id: string; ssoProvider: string | null } | null>;
  /** Find an SsoConnection that has ssoEnforced=true and is verified for this domain */
  findEnforcedSsoConnection(domain: string): Promise<{ organizationId: string } | null>;
  /** Check active plan type; returns null if plan check fails (silently degrades enforcement) */
  getActivePlanType(organizationId: string): Promise<string | null>;
  /** Find a user by email (for sole-admin escape-hatch check) */
  findUserByEmail(email: string): Promise<{ id: string } | null>;
  /** Count active admins in the org */
  countActiveAdmins(organizationId: string): Promise<number>;
  /** Check if the user is an admin of the org */
  findUserAdmin(params: { userId: string; organizationId: string }): Promise<{ userId: string } | null>;
}

/**
 * Checks whether a credential endpoint request (sign-in or password-reset)
 * should be blocked due to SSO enforcement for the request's email domain.
 *
 * Throws `APIError` with code `SSO_ENFORCED` when the request must be rejected.
 * Returns normally (void) when the request should be allowed through.
 *
 * The function is extracted from the BetterAuth before-hook so that the
 * enforcement logic can be unit-tested without booting the full auth stack.
 *
 * @param params.email  - Email from the request body (may be undefined)
 * @param params.path   - The BetterAuth endpoint path (e.g. "/sign-in/email")
 * @param params.deps   - Injected database query functions
 */
export async function checkSsoEnforcement({
  email,
  path,
  deps,
}: {
  email: string | undefined;
  path: string;
  deps: SsoEnforcementDeps;
}): Promise<void> {
  if (!email || typeof email !== "string") return;

  const atIdx = email.indexOf("@");
  if (atIdx === -1 || atIdx !== email.lastIndexOf("@")) return;
  const domain = email.slice(atIdx + 1).toLowerCase();
  if (!domain) return;

  const isSignIn = path.endsWith("/sign-in/email") || path.includes("/sign-in/email?");
  const isPasswordReset =
    path.endsWith("/request-password-reset") || path.includes("/request-password-reset?");

  if (!isSignIn && !isPasswordReset) return;

  // Phase 1: legacy ssoDomain field on Organization
  const org = await deps.findOrgByDomain(domain);

  // Phase 2: SsoConnection with ssoEnforced=true
  const ssoConnection = await deps.findEnforcedSsoConnection(domain);

  let enforcedOrgId =
    ssoConnection?.organizationId ?? (org?.ssoProvider ? org.id : null);

  // Login-time license revalidation: if the org's enterprise license
  // expired, silently degrade SSO enforcement so users aren't locked out.
  if (enforcedOrgId) {
    const planType = await deps.getActivePlanType(enforcedOrgId);
    if (planType !== "ENTERPRISE") {
      enforcedOrgId = null;
    }
  }

  if (enforcedOrgId && isSignIn) {
    // Sole-owner escape hatch: allow password login if the user is the
    // only active ADMIN so they can recover during IdP outages.
    const user = await deps.findUserByEmail(email);
    if (user) {
      const activeAdminCount = await deps.countActiveAdmins(enforcedOrgId);
      const userIsAdmin = await deps.findUserAdmin({
        userId: user.id,
        organizationId: enforcedOrgId,
      });
      if (userIsAdmin && activeAdminCount === 1) {
        return;
      }
    }
  }

  if (enforcedOrgId) {
    throw APIError.from("FORBIDDEN", {
      code: "SSO_ENFORCED",
      message:
        "Your organization requires SSO login. Please use your identity provider to sign in.",
    });
  }
}
