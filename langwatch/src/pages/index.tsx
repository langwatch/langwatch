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
    // Persona-1 (personal-only): authenticated user with no org membership.
    // Their home is /me, NOT /onboarding/welcome — the persona-aware-chrome
    // spec treats org-less CLI/IDE devs as a first-class persona, not as
    // unfinished onboarding. Falls through to the org-creation bounce only
    // if the user explicitly opens /onboarding/welcome themselves.
    if (
      !isLoading &&
      !organization &&
      (organizations?.length ?? 0) === 0
    ) {
      void router.replace("/me");
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
