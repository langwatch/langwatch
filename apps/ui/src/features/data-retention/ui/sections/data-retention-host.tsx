/**
 * What the Data Retention screen is mounted inside: the tRPC Provider its
 * hooks run on, and the host port for scope, plan, flags, visible scopes,
 * address and feedback. Reads the whole graph — wider than the writable set — since the filter must show every visible scope.
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
