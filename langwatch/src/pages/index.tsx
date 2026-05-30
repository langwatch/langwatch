import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { LoadingScreen } from "../components/LoadingScreen";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * `/` redirect — picks the right home for the user's persona via the
 * `api.governance.resolveHome` tRPC procedure. Falls back to the
 * existing project-default redirect if the resolver query is still
 * loading or fails, so the LLMOps majority experience never regresses
 * on transient backend errors.
 *
 * Spec: specs/ai-gateway/governance/persona-home-resolver.feature
 */
export default function Index() {
  const { project, organization, organizations, isLoading } =
    useOrganizationTeamProject({ redirectToOnboarding: false });
  const router = useRouter();

  const resolved = api.governance.resolveHome.useQuery(
    { organizationId: organization?.id ?? "" },
    {
      enabled: !!organization?.id,
      staleTime: 60_000,
      retry: false,
    },
  );

  // Implicit home-kind preference written from MyLayout (personal) and
  // useOrganizationTeamProject (project). Honored only when the user
  // has no explicit pin via the picker, so /me sticks the same way the
  // last project does without overriding the user's deliberate choice.
  const [lastVisitedHomeKind] = useLocalStorage<"" | "project" | "personal">(
    "lastVisitedHomeKind",
    "",
  );

  useEffect(() => {
    if (resolved.data?.destination) {
      // Explicit picker pin always wins. Only override the auto-detected
      // destination when the user has no pin AND their last visit was /me.
      // Gate on governanceUiEnabled: /me is flag-gated and 404s for orgs
      // without it, so never fall back there for a non-governance org (this
      // is the admin's own localStorage leaking into an impersonated
      // session — the impersonated customer must not be sent to /me).
      const detectedFallback =
        resolved.data.governanceUiEnabled &&
        !resolved.data.isOverride &&
        lastVisitedHomeKind === "personal" &&
        resolved.data.destination !== "/me";
      void router.replace(detectedFallback ? "/me" : resolved.data.destination);
      return;
    }
    if (resolved.isError && project) {
      void router.replace(`/${project.slug}`);
      return;
    }
    // No org membership → bootstrap. Caught by Ariana QA dogfood (G73):
    // the previous behavior routed all org-less users to /me, which is
    // a dead-end for fresh-signup admins (no projects → skeleton cards
    // → no discoverable path to /onboarding/welcome → /governance hits
    // organization:manage gate and renders Access Restricted). The
    // /auth/signup → /me → stuck funnel was the actual onboarding break.
    //
    // /onboarding/welcome is the bootstrap page that creates the org +
    // first project (via `api.onboarding.initializeOrganization`); after
    // that step the user has an org and the LLMOps / governance home
    // resolver picks the right destination on subsequent hits. Persona-1
    // (genuinely-personal-only OSS CLI/IDE devs) can opt out from the
    // welcome page if/when that surface ships an explicit skip — until
    // then, treating org-less users as needing onboarding is the
    // less-broken default (admin funnel works; personal-only user hits
    // an extra page they can navigate away from, vs admin funnel
    // hitting an unrecoverable dead-end on /me).
    if (
      !isLoading &&
      !organization &&
      (organizations?.length ?? 0) === 0
    ) {
      void router.replace("/onboarding/welcome");
    }
  }, [
    resolved.data,
    resolved.isError,
    project,
    organization,
    organizations,
    isLoading,
    router,
    lastVisitedHomeKind,
  ]);

  return <LoadingScreen />;
}
