import { useRouter } from "~/utils/compat/next-router";
import { useEffect } from "react";
import { useLocalStorage } from "usehooks-ts";
import { LoadingScreen } from "../components/LoadingScreen";
import { useOrganizationTeamProject } from "../hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import { resolveHomeDestination } from "~/utils/resolveHomeDestination";

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
  // has no explicit pin via the picker, so /me AND the last-visited project
  // both stick, without overriding the user's deliberate choice.
  const [lastVisitedHomeKind] = useLocalStorage<"" | "project" | "personal">(
    "lastVisitedHomeKind",
    "",
  );

  useEffect(() => {
    if (resolved.data?.destination) {
      // The persona resolver picks the DEFAULT for a user with no history. On
      // top of that we honor the last-visited home so it sticks both ways: a
      // user whose persona default is /me still returns to the project they
      // last opened, and /me sticks for someone who last sat there. `project`
      // here is the last-visited project (useOrganizationTeamProject resolves
      // it from the selectedProjectSlug on a slug-less route). An explicit
      // picker pin (isOverride) always wins.
      void router.replace(
        resolveHomeDestination({
          resolverDestination: resolved.data.destination,
          isOverride: resolved.data.isOverride,
          governanceUiEnabled: resolved.data.governanceUiEnabled,
          lastVisitedHomeKind,
          lastProjectSlug: project?.slug ?? null,
          // The org the resolver ran against; carried onto /me and /governance
          // so the org-scoped page re-pins to it instead of 404ing behind its
          // feature-flag guard when the selected project's org has drifted.
          organizationSlug: organization?.slug ?? null,
        }),
      );
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
