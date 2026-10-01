import { useSession } from "./auth-client.tsx";
import { useRouter } from "./use-route.ts";

export const publicRoutes = [
  "/share/[id]",
  "/auth/signin",
  "/auth/signup",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
  "/auth/error",
];

/**
 * Routes requiring auth but exempt from bouncer during invite accept or join-before-create
 */
export const noOrgBouncerRoutes = [
  "/invite/accept",
  // Join before create (ADR-117 §6). A brand-new account is signed in and has
  // no organization by definition when it lands here, which is the state this
  // step exists to resolve — the bouncer must not resolve it first.
  "/auth/join",
  // The CLI device-login approval page. The global bouncer (e.g.
  // CommandBar's useOrganizationTeamProject) must never swallow
  // /cli/auth?user_code=… into onboarding — the page handles the no-org
  // case itself by round-tripping through onboarding with return_to.
  "/cli/auth",
  // Where a single sign-on test sign-in lands: the tester belongs to no
  // organization by design, and the bootstrap is what that page replaces.
  "/auth/sso-test-complete",
  "/onboarding/welcome",
  "/onboarding/[team]/project",
  "/onboarding/product",
  // Org-scoped governance pages — admin in an empty org (no project yet)
  // must still reach /governance/* to set up sources and rules. Bouncing
  // them to /onboarding/welcome is wrong: they ALREADY have an org, they
  // just haven't created a project yet (and may never need to; governance
  // is org-scoped).
  "/governance",
  "/governance/inventory",
  "/governance/inventory/[id]",
  "/governance/people",
  "/governance/costs",
  "/governance/billed",
  "/governance/insights",
  "/governance/analytics",
  "/governance/signals",
  "/governance/agents",
  // The retired addresses stay exempt so each redirect route renders
  // before the bouncer fires (cost-centers precedent below).
  "/governance/catalog",
  "/governance/catalog/[id]",
  "/governance/ingestion-sources",
  "/governance/ingestion-sources/[id]",
  "/governance/anomaly-rules",
  "/governance/tool-catalog",
  "/governance/departments",
  "/governance/cost-centers",
  "/governance/teams",
  "/governance/teams/[id]",
  "/governance/users",
  "/governance/users/[id]",
  // Routing policies is a gateway page, and it is the one an admin in an
  // empty org has to reach first: `langwatch login` fails with
  // no_default_routing_policy until a default policy exists, and that
  // happens before the org has any project.
  "/gateway/routing-policies",
  // Personal-scope pages: persona-1 (org-less CLI/IDE devs) has a legitimate
  // home at /me + /me/configure with no org required. Without this exemption,
  // CommandBar's onboarding redirect wins the race and dumps them on
  // /onboarding/welcome — the opposite of the p1 storyboard.
  "/me",
  "/me/configure",
  // `pages/index.tsx` already resolves the right home per persona (via
  // api.governance.resolveHome, falling back to /me for org-less p1). The
  // no-org bouncer must defer to it, or CommandBar wins the race and dumps
  // p1 on /onboarding/welcome before the resolver effect fires.
  "/",
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
