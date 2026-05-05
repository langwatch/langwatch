import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";
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

  useEffect(() => {
    if (resolved.data?.destination) {
      void router.replace(resolved.data.destination);
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
  ]);

  return <LoadingScreen />;
}
