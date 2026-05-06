import { useMemo } from "react";

import { useRequiredSession } from "~/hooks/useRequiredSession";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

import type { WorkspaceSwitcherProps } from "./WorkspaceSwitcher";

/**
 * Build the WorkspaceSwitcher's `personal` / `teams` / `projects` data from
 * the user's resolved organization context. Layout-agnostic — any header
 * (DashboardLayout, MyLayout, future SettingsLayout) can call this and
 * render `<WorkspaceSwitcher {...useWorkspaceData()} />` without further
 * wiring. `current` is auto-derived inside the switcher via
 * `useWorkspaceCurrent`, so consumers don't need to thread it.
 *
 * Personal teams owned by OTHER users are filtered out — every user has a
 * private personal team (Team.isPersonal=true, ownerUserId=them) which
 * never appears in another user's switcher, even when an org admin can
 * structurally see them in the org.teams payload.
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 */
export function useWorkspaceData(): Pick<
  WorkspaceSwitcherProps,
  "personal" | "teams" | "projects"
> {
  const { organizations } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const session = useRequiredSession();
  const meUserId = session.data?.user?.id;

  return useMemo(() => {
    const personal = {
      kind: "personal" as const,
      href: "/me",
      label: "My Workspace",
      subtitle: "Personal usage, personal budget",
    };

    const isVisibleTeam = (team: { isPersonal?: boolean; ownerUserId?: string | null }) =>
      !(team.isPersonal && team.ownerUserId && team.ownerUserId !== meUserId);

    const teams = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).filter(isVisibleTeam).map((team) => ({
          kind: "team" as const,
          teamId: team.id,
          teamSlug: team.slug,
          orgId: org.id,
          orgName: org.name,
          href: `/settings/teams/${team.slug}`,
          label: team.name,
        })),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    const projects = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).filter(isVisibleTeam).flatMap((team) =>
          (team.projects ?? []).map((project) => ({
            kind: "project" as const,
            projectId: project.id,
            projectSlug: project.slug,
            teamId: team.id,
            orgId: org.id,
            orgName: org.name,
            href: `/${project.slug}`,
            label: project.name,
          })),
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    return { personal, teams, projects };
  }, [organizations, meUserId]);
}
