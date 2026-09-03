/**
 * What the project home is mounted inside: the tRPC Provider its hooks run
 * on, and the host port for reader, scope, grants, rollouts and deployment.
 * `langy:view` shows the panel; `langy:create` is needed for a hand-off.
 */

import {
  homeApi,
  ProjectHomeHostProvider,
  type ProjectHomeDeployment,
  type ProjectHomeHostPort,
  type ProjectHomeOrganization,
  type ProjectHomeProject,
  type ProjectHomeUser,
} from "@langwatch/project-web/screens/home";
import { useMemo, type ReactNode } from "react";

import { readPublicAppConfig } from "../../../../behavior/public-config";
import { isLangyDemoProject } from "../../../../behavior/langy-demo-project";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiPrefersReducedMotion } from "../../../../behavior/ui-reduced-motion";

/** The two Langy grants, and the rollout that reveals it at all. */
const LANGY_VIEW_PERMISSION = "langy:view";
const LANGY_CREATE_PERMISSION = "langy:create";
const LANGY_RELEASE_FLAG = "release_langy_enabled";

/** The organization graph, narrowed to what the home reads off it. */
type OrganizationsRead = ReadonlyArray<{
  id: string;
  name: string;
  teams: Array<{
    projects: Array<{
      id: string;
      name: string;
      slug: string;
      firstMessage?: boolean | null;
      apiKey?: string | null;
    }>;
  }>;
}>;

/** What kind of deployment this is: a document with no config block reads as self-hosted, never a crash. */
function readDeployment(): ProjectHomeDeployment {
  try {
    const config = readPublicAppConfig();
    return {
      isSaaS: config.deployment === "saas",
      isDevelopment: config.mode === "development",
      ...(config.demoProjectSlug ? { demoProjectSlug: config.demoProjectSlug } : {}),
      // Where this deployment receives traces IS its own base URL; only a
      // self-hosted one has to name it in a copied setup at all.
      baseHost: config.appBaseUrl,
    };
  } catch {
    return { isSaaS: false, isDevelopment: false };
  }
}

export function ProjectHomeHostSection({ children }: { children: ReactNode }) {
  const { session, navigation } = useUiCapabilities();
  const scope = session.activeScope();
  const reducedMotion = useUiPrefersReducedMotion();

  const organizations = homeApi.organization.getAll.useQuery({ isDemo: false });

  const organization: ProjectHomeOrganization | undefined = useMemo(() => {
    const found = ((organizations.data ?? []) as OrganizationsRead).find(
      (candidate) => candidate.id === scope.organizationId,
    );
    return found ? { id: found.id, name: found.name } : void 0;
  }, [organizations.data, scope.organizationId]);

  const project: ProjectHomeProject | undefined = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const candidate of (organizations.data ?? []) as OrganizationsRead) {
      for (const team of candidate.teams) {
        const found = team.projects.find((entry) => entry.id === scope.projectId);
        if (found) return found;
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const actor = session.currentUser();
  const currentUser: ProjectHomeUser | undefined = useMemo(
    () => (actor ? { id: actor.id, name: actor.name } : void 0),
    [actor],
  );

  const langyFlag = session.featureFlag(LANGY_RELEASE_FLAG);
  const deployment = useMemo(readDeployment, []);
  const isDemoProject = isLangyDemoProject({
    projectSlug: project?.slug,
    demoProjectSlug: deployment.demoProjectSlug,
  });

  const host = useMemo<ProjectHomeHostPort>(
    () => ({
      project: () => project,
      organization: () => organization,
      currentUser: () => currentUser,
      // The graph is what the project and the organization are read off, so
      // "still arriving" is exactly this query being unsettled.
      isLoading: () => organizations.isLoading,
      hasPermission: (permission) => session.hasPermission(permission),
      featureFlag: (flag) => {
        const answer = session.featureFlag(flag);
        return { enabled: answer === true, isLoading: answer === void 0 };
      },
      langyVisibility: () => ({
        show: session.hasPermission(LANGY_VIEW_PERMISSION) && langyFlag === true && !isDemoProject,
        // "No" and "not yet" are different answers, and only the second one
        // may hold the page back from picking a composition.
        isResolving: organizations.isLoading || langyFlag === void 0,
      }),
      canAskLangy: () =>
        session.hasPermission(LANGY_CREATE_PERMISSION) && langyFlag === true && !isDemoProject,
      deployment: () => deployment,
      reducedMotion: () => reducedMotion,
      navigate: (to) => navigation.navigate(to),
    }),
    [
      project,
      organization,
      currentUser,
      organizations.isLoading,
      langyFlag,
      deployment,
      isDemoProject,
      reducedMotion,
      session,
      navigation,
    ],
  );

  return <ProjectHomeHostProvider value={host}>{children}</ProjectHomeHostProvider>;
}
