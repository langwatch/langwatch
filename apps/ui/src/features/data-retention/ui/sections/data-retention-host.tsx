/**
 * What the Data Retention screen is mounted inside.
 *
 * Three things go around `/settings/data-retention`: the tRPC Provider the
 * package's own hooks run on, the host port that answers for the scope, the
 * plan tier, the platform-admin flag, the visible scopes, the address and the
 * feedback — and nothing else. A screen stays a screen module.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product
 * want it. This family reads the whole graph because the scope FILTER offers
 * every scope the reader can see, which is deliberately wider than the
 * RBAC-filtered set the snapshot says they may write to.
 *
 * THE TEAM IS DERIVED, NOT ASKED. `UiActiveScope` carries the organization and
 * the project; the retention page also needs the team the project belongs to,
 * for "This Team" and for the scope cascade. It is one lookup in the graph
 * already read, which is cheaper and more consistent than a second query.
 */

import {
  dataRetentionApi,
  DataRetentionHostProvider,
  type DataRetentionHostPort,
  type RetentionAvailableScopes,
} from "@langwatch/data-retention-web/screens/data-retention";
import { useMemo, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import {
  useUiOrganizationFacts,
  useUiPlatformAdmin,
} from "../../../../behavior/ui-organization-facts";

type OrganizationGraphEntry = {
  id: string;
  name: string;
  teams: Array<{
    id: string;
    name: string;
    projects: Array<{ id: string; name: string }>;
  }>;
};

export function DataRetentionHost({ children }: { children: ReactNode }) {
  const { session, route, feedback } = useUiCapabilities();
  const activeScope = session.activeScope();
  const { isEnterprise } = useUiOrganizationFacts();
  const isPlatformAdmin = useUiPlatformAdmin();

  const organizations = dataRetentionApi.organization.getAll.useQuery({ isDemo: false });

  const organization = useMemo(
    () =>
      (organizations.data ?? []).find(
        (candidate: OrganizationGraphEntry) => candidate.id === activeScope.organizationId,
      ),
    [organizations.data, activeScope.organizationId],
  );

  const teamId = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const team of organization?.teams ?? []) {
      if (team.projects.some((project) => project.id === activeScope.projectId)) {
        return team.id;
      }
    }
    return void 0;
  }, [organization, activeScope.projectId]);

  // The scope filter's options: everything the reader can SEE, derived from the
  // one graph read. `useAvailableScopes` did exactly this in `platform/app`.
  const availableScopes = useMemo<RetentionAvailableScopes>(() => {
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
  const host = useMemo<DataRetentionHostPort>(
    () => ({
      scope: () => ({
        organizationId: activeScope.organizationId ?? void 0,
        teamId,
        projectId: activeScope.projectId ?? void 0,
      }),
      hasPermission: (permission) => session.hasPermission(permission),
      availableScopes: () => availableScopes,
      isPlatformAdmin: () => isPlatformAdmin,
      isEnterprise: () => isEnterprise,
      route: () => reading,
      setQuery: (next, options) => route.setQuery(next, options),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [
      activeScope.organizationId,
      activeScope.projectId,
      teamId,
      availableScopes,
      isPlatformAdmin,
      isEnterprise,
      reading,
      route,
      session,
      feedback,
    ],
  );

  return <DataRetentionHostProvider value={host}>{children}</DataRetentionHostProvider>;
}
