import { useRouter } from "next/router";
import { useSession } from "~/utils/auth-client";

export const publicRoutes = ["/share/[id]", "/auth/signin", "/auth/signup", "/auth/error"];

/**
 * Routes that REQUIRE authentication but should NOT be subject to the
 * `useOrganizationTeamProject` onboarding bouncer.
 *
 * These are routes where an authenticated user with zero organizations
 * is in a legitimate state — they're in the middle of accepting an
 * invitation that will create their first OrganizationUser row, or
 * they're in the onboarding flow itself. Without this exemption, the
 * `CommandBar` (mounted globally in `_app.tsx`) calls
 * `useOrganizationTeamProject({redirectToOnboarding: true})` and races
 * with the `acceptInviteMutation` in `/invite/accept`. For VALID
 * invites the mutation's `window.location.href = ...` hard-redirect
 * usually wins; for INVALID invites (expired, NOT_FOUND, FORBIDDEN)
 * the bouncer wins, silently masking the error UI and dumping the
 * user on `/onboarding/welcome` with no explanation. Caught by iter
 * 47 of the BetterAuth migration audit.
 */
export const noOrgBouncerRoutes = [
  "/invite/accept",
  "/onboarding/welcome",
  "/onboarding/[team]/project",
  "/onboarding/product",
];

export const useRequiredSession = (
  { required = true }: { required?: boolean } = { required: true },
) => {
  const router = useRouter();

  const session = useSession({
    required,
    onUnauthenticated: required
      ? () => {
          if (publicRoutes.includes(router.route)) return;
          if (navigator.onLine) {
            // Redirect to /auth/signin which detects the configured auth
            // provider from publicEnv.NEXTAUTH_PROVIDER and either shows
            // the credentials form or auto-redirects to the OAuth provider.
            // This is correct for email/on-prem, google, auth0, azure-ad, etc.
            // Preserves the current URL so we can come back after signin.
            const callbackUrl = encodeURIComponent(
              window.location.pathname + window.location.search,
            );
            window.location.href = `/auth/signin?callbackUrl=${callbackUrl}`;
          } else {
            window.addEventListener("online", () => window.location.reload());
          }
        }
      : undefined,
  });

  return session;
};
