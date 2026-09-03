/**
 * What the two Model Provider screens are mounted inside: the tRPC Provider
 * their hooks run on, and the host port for scope, grants, visible scopes,
 * address, feedback and the three platform drawers.
 */

import {
  modelProviderApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
  type ModelProviderHostPort,
} from "@langwatch/model-provider-web/screens/model-provider";
import { useMemo, type ReactNode } from "react";
import { DRAWER_OPEN_PARAM } from "../../../drawers";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { openPlatformDrawer } from "../../behavior/model-provider-open-platform-drawer";

type OrganizationGraphEntry = {
  id: string;
  name: string;
  teams: Array<{
    id: string;
    name: string;
    projects: Array<{ id: string; name: string; slug: string }>;
  }>;
};

export function ModelProviderHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();

  const organizations = modelProviderApi.organization.getAll.useQuery({ isDemo: false });

  const organization = useMemo(
    () =>
      ((organizations.data ?? []) as OrganizationGraphEntry[]).find(
        (candidate) => candidate.id === activeScope.organizationId,
      ),
    [organizations.data, activeScope.organizationId],
  );

  /** The team the project in scope belongs to, and its slug (for the cost drawer's `/<slug>/traces` preview) — both derived from the one graph read. */
  const { teamId, projectSlug } = useMemo(() => {
    if (!activeScope.projectId) return { teamId: void 0, projectSlug: void 0 };
    for (const team of organization?.teams ?? []) {
      const project = team.projects.find((candidate) => candidate.id === activeScope.projectId);
      if (project) return { teamId: team.id, projectSlug: project.slug };
    }
    return { teamId: void 0, projectSlug: void 0 };
  }, [organization, activeScope.projectId]);

  // Everything the reader can SEE: the scope filter's options, and the names the
  // per-row scope chips resolve their ids to. Deliberately wider than the
  // RBAC-filtered set the editor's chip picker writes to — narrowing the filter
  // to writable scopes would hide rows a project-only reader may read.
  const availableScopes = useMemo<ModelProviderAvailableScopes>(() => {
    const teams = organization?.teams ?? [];
    return {
      organization: organization ? { id: organization.id, name: organization.name } : null,
      teams: teams.map((team) => ({ id: team.id, name: team.name })),
      projects: teams.flatMap((team) =>
        team.projects.map((project) => ({
          id: project.id,
          name: project.name,
          teamId: team.id,
        })),
      ),
    };
  }, [organization]);

  const reading = route.reading();
  const host = useMemo<ModelProviderHostPort>(
    () => ({
      scope: () => ({
        organizationId: activeScope.organizationId ?? void 0,
        teamId,
        projectId: activeScope.projectId ?? void 0,
        projectSlug,
      }),
      availableScopes: () => availableScopes,
      route: () => reading,
      hasPermission: (permission) => session.hasPermission(permission),
      setQuery: (next, options) => route.setQuery(next, options),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
      // Recorded gap: platform/app's dedup WeakSet lives on its own
      // MutationCache, which doesn't wrap this application's client.
      isReportedGlobally: () => false,
      openPlatformDrawer: ({ drawer, params }) =>
        openPlatformDrawer({
          drawer,
          params,
          query: reading.query,
          drawerOpenParam: DRAWER_OPEN_PARAM,
          setQuery: route.setQuery,
        }),
    }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      teamId,
      projectSlug,
      availableScopes,
      reading,
      route,
      session,
      feedback,
    ],
  );

  return <ModelProviderHostProvider value={host}>{children}</ModelProviderHostProvider>;
}

export { modelProviderApi };
