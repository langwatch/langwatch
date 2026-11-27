/**
 * Project's lent switcher (ARCHITECTURE §10) for pages that borrow it: the design
 * system's one project picker, the top bar's, over the graph as it arrives. Picking
 * keeps main's destination (`projectSwitchHref`). Spec: specs/navigation/one-project-picker.feature
 */

import { useUiHostServices, useUiScope } from "@langwatch/browser-host/capabilities";
import { ProjectPicker, type ProjectPickerGroup } from "@langwatch/design-system/project-picker";
import { isAggregateProjectKind } from "@langwatch/project-contract";

import { projectApi } from "../../behavior/project-api.ts";
import { projectSwitchGroups, projectSwitchHref } from "../../model/project-switch.ts";

export default function ProjectSwitcher() {
  const { navigation, route, session } = useUiHostServices();
  const { organizationId, projectId } = useUiScope().activeScope();
  const organizations = projectApi.organization.getScopeGraph.useQuery({});
  const graph = organizations.data ?? [];

  const current = graph
    .flatMap((organization) => organization.teams.flatMap((team) => team.projects))
    .find((project) => project.id === projectId);
  if (!current) return null;

  const { pathname = "", query } = route.reading();
  const groups: ProjectPickerGroup[] = projectSwitchGroups(graph, {
    userId: session.currentUser()?.id,
    organizationId,
  }).map((group) => ({
    team: { teamId: group.key, orgId: group.organizationId, label: group.title },
    projects: group.projects.map((project) => ({
      projectId: project.id,
      label: project.name,
      isAggregate: isAggregateProjectKind(project.kind),
      href: projectSwitchHref({
        pathname,
        query,
        currentProjectSlug: current.slug,
        targetSlug: project.slug,
      }),
    })),
  }));

  return (
    <ProjectPicker
      groups={groups}
      currentProjectId={current.id}
      currentProjectName={current.name}
      currentProjectIsAggregate={isAggregateProjectKind(current.kind)}
      showTeamHeaders={groups.length > 1}
      onOpenProject={(href) => navigation.navigate(href)}
      // Every borrowing page draws the chip at the right of its header.
      align="end"
    />
  );
}
