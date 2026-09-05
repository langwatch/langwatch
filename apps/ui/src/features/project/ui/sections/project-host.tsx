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
} from "@langwatch/project-web/screens/project-settings";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ReactNode } from "react";

import { useUiCapabilities } from "@langwatch/ui-host/capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { useUiShellFailure } from "../../../../behavior/ui-shell-failure";
import { UiPageFailure, UiPageLoading } from "../../../../ui/sections/ui-page-fallbacks";
import { UiProjectSwitcher } from "../../../../ui/blocks/ui-project-switcher";

export function ProjectHost({ children }: { children: ReactNode }) {
  const { session, feedback } = useUiCapabilities();
  const { isLiteMember } = useUiOrganizationFacts();
  const { openDrawer } = useDrawer();
  const scope = session.activeScope();

  const organizations = projectApi.organization.getAll.useQuery({ isDemo: false });

  // A refused graph is a state, not an empty one: `organization` and
  // `project` below are read off this query, so a refusal left the settings
  // screen empty forever.
  const failure = useUiShellFailure({
    error: organizations.error,
    fallbackTitle: "Couldn't load your project settings",
  });

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

  if (failure.departing) return <UiPageLoading />;
  if (failure.copy) return <UiPageFailure copy={failure.copy} />;

  return <ProjectHostProvider value={host}>{children}</ProjectHostProvider>;
}

export { projectApi };
