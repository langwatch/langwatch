/**
 * What the two Model Provider screens are mounted inside.
 *
 * Three things go around `/settings/model-providers` and
 * `/settings/model-costs`: the tRPC Provider the package's own hooks run on, the
 * host port that answers for the scope, the grants, the visible scopes, the
 * address, the feedback and the three platform drawers — and nothing else. A
 * screen stays a screen module.
 *
 * The reads live here rather than in the adapter for a reason worth keeping: the
 * adapter is a value object over what has already been read, so a test
 * constructs one, while a hook cannot be constructed at all.
 *
 * `organization.getAll` is asked with the same input the application shell asks
 * with, which under tRPC's path-plus-input cache key is the same entry: the
 * graph is fetched once for the document however many halves of the product want
 * it. `useAvailableScopes` derived exactly this from the same graph in
 * `platform/app`.
 *
 * THE TEAM IS DERIVED, NOT ASKED, the same way the retention family derives it.
 * `UiActiveScope` carries the organization and the project; the providers page
 * also needs the team the project belongs to, for the filter's "This Team" and
 * for the cascade. It is one lookup in the graph already read.
 */

import {
  modelProviderApi,
  ModelProviderHostProvider,
  type ModelProviderAvailableScopes,
} from "@langwatch/model-provider-web/screens/model-provider";
import { useMemo, type ComponentType, type ReactNode } from "react";
import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { UiModelProviderHost } from "../../behavior/model-provider-host.adapter";

type OrganizationGraphEntry = {
  id: string;
  name: string;
  teams: Array<{
    id: string;
    name: string;
    projects: Array<{ id: string; name: string }>;
  }>;
};

function ModelProviderHost({ children }: { children: ReactNode }) {
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

  const teamId = useMemo(() => {
    if (!activeScope.projectId) return void 0;
    for (const team of organization?.teams ?? []) {
      if (team.projects.some((project) => project.id === activeScope.projectId)) {
        return team.id;
      }
    }
    return void 0;
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
  const host = useMemo(
    () =>
      UiModelProviderHost.create(
        {
          scope: {
            organizationId: activeScope.organizationId ?? void 0,
            teamId,
            projectId: activeScope.projectId ?? void 0,
          },
          availableScopes,
          route: reading,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          setQuery: (next, options) => route.setQuery(next, options),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [
      activeScope.organizationId,
      activeScope.projectId,
      teamId,
      availableScopes,
      reading,
      route,
      session,
      feedback,
    ],
  );

  return <ModelProviderHostProvider value={host}>{children}</ModelProviderHostProvider>;
}

/** Wraps a Model Provider screen in the host its package asks for. */
export function withModelProviderHost<P extends object>(
  Screen: ComponentType<P>,
): ComponentType<P> {
  const Mounted = (props: P) => (
    <ModelProviderHost>
      <Screen {...props} />
    </ModelProviderHost>
  );
  Mounted.displayName = `withModelProviderHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
