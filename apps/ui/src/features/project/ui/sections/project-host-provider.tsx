/**
 * What the general Settings screen is mounted inside.
 *
 * Two things go around `/settings`: the tRPC Provider the package's own hooks
 * run on, and the host port that answers for the organization, the project, the
 * grants, the flag, the switcher, the overlay address and the two notices.
 *
 * THE ORGANIZATION AND THE PROJECT COME OFF THE GRAPH THE SHELL ALREADY HOLDS.
 * This page EDITS the two rows, so it needs their current values as form
 * defaults — and `organization.getAll` already carries both in full, which is
 * exactly what `useOrganizationTeamProject` handed the platform page. Same
 * input, same tRPC cache entry, no read of this family's own, and the refetch
 * the save fires is what puts the new values back on the page.
 *
 * A PERSONAL WORKSPACE IS NOT THE ORGANIZATION'S PROJECT, and the screen makes
 * that check rather than this provider: the port answers what the address names,
 * and the page decides what to render for it.
 */

import {
  projectApi,
  ProjectHostProvider,
  type ProjectHostOrganization,
  type ProjectHostProject,
} from "@langwatch/project-web/screens/project";
import { useDrawer } from "@langwatch/ui-drawer";
import { useMemo, type ComponentType, type ReactNode } from "react";

import { useUiCapabilities } from "../../../../behavior/ui-capabilities";
import { useUiOrganizationFacts } from "../../../../behavior/ui-organization-facts";
import { UiProjectSwitcher } from "../../../chrome";
import { UiProjectHost } from "../../behavior/project-host.adapter";

function ProjectHost({ children }: { children: ReactNode }) {
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

  const host = useMemo(
    () =>
      UiProjectHost.create(
        {
          organization,
          project,
          isLiteMember,
          projectSwitcher: <UiProjectSwitcher />,
        },
        {
          hasPermission: (permission) => session.hasPermission(permission),
          isFeatureEnabled: (flag) => session.isFeatureEnabled(flag),
          openOverlay: (name, props) => openDrawer(name, props),
          succeeded: (notice) => feedback.succeeded(notice),
          failed: (failure) => feedback.failed(failure),
        },
      ),
    [organization, project, isLiteMember, session, feedback, openDrawer],
  );

  return <ProjectHostProvider value={host}>{children}</ProjectHostProvider>;
}

/** Wraps the Settings screen in the host its package asks for. */
export function withProjectHost<P extends object>(Screen: ComponentType<P>): ComponentType<P> {
  const Mounted = (props: P) => (
    <ProjectHost>
      <Screen {...props} />
    </ProjectHost>
  );
  Mounted.displayName = `withProjectHost(${Screen.displayName ?? Screen.name ?? "Screen"})`;
  return Mounted;
}
