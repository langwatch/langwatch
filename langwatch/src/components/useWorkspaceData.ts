import { useMemo } from "react";

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
 * Personal teams are filtered out across the board. Every user has a
 * private personal team (Team.isPersonal=true, ownerUserId=them) — yours
 * is already represented by the top-level "My Workspace" entry, and
 * other users' never belong in your switcher. Surfacing your own would
 * render as an "Org > Personal Workspace" duplicate of the personal
 * entry above (rchaves caught this in dogfood). Same filter cascades to
 * projects since they iterate via the filtered team list.
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

  return useMemo(() => {
    const personal = {
      kind: "personal" as const,
      href: "/me",
      label: "My Workspace",
      subtitle: "Personal usage, personal budget",
    };

    // Personal teams never render in the team list — the top-level
    // "My Workspace" entry already covers the caller's own one, and
    // every other user's belongs only to them. Cascades to projects
    // since the projects flatMap iterates this filtered team list.
    const isVisibleTeam = (team: { isPersonal?: boolean }) => !team.isPersonal;

    const teams = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).filter(isVisibleTeam).map((team) => ({
          kind: "team" as const,
          teamId: team.id,
          teamSlug: team.slug,
          orgId: org.id,
          orgName: org.name,
          orgSlug: org.slug,
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
            orgSlug: org.slug,
            href: `/${project.slug}`,
            label: project.name,
          })),
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    return { personal, teams, projects };
  }, [organizations]);
}
