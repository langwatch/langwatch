/**
 * What the general Settings screen is mounted inside: the tRPC Provider its
 * hooks run on, and the host port for organization, project, grants, flag,
 * switcher, overlay address and feedback — both rows' current values, since this page edits them.
 */

import {
  projectApi,
  ProjectHostProvider,
  type ProjectHostOrganization,
  type ProjectHostPort,
  type ProjectHostProject,
} from "@langwatch/project-web/screens/project";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiProjectSwitcher } from "../../../chrome";

export function ProjectHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { isLiteMember } = useUiOrganizationFacts();
  const { openDrawer } = useDrawer();
  const scope = session.activeScope();

  const organizations = projectApi.organization.getAll.useQuery({ isDemo: false });

  const organization: ProjectHostOrganization | undefined = useMemo(
    () => (organizations.data ?? []).find((candidate) => candidate.id === scope.organizationId),
    [organizations.data, scope.organizationId],
  );

  const project: ProjectHostProject | undefined = useMemo(() => {
    if (!scope.projectId) return void 0;
    for (const candidate of organizations.data ?? []) {
      for (const team of candidate.teams) {
        const found = team.projects.find((entry) => entry.id === scope.projectId);
        if (found) return found;
      }
    }
    return void 0;
  }, [organizations.data, scope.projectId]);

  const host = useMemo<ProjectHostPort>(
    () => ({
      organization: () => organization,
      project: () => project,
      hasPermission: (permission) => session.hasPermission(permission),
      isLiteMember: () => isLiteMember,
      isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
      projectSwitcher: () => <UiProjectSwitcher />,
      openOverlay: (name, props) => openDrawer(name, props),
      succeeded: (notice) => feedback.succeeded(notice),
      failed: (failure) => feedback.failed(failure),
    }),
    [organization, project, isLiteMember, session, feedback, openDrawer],
  );

  return <ProjectHostProvider value={host}>{children}</ProjectHostProvider>;
}

export { projectApi };
