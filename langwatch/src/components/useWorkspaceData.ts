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

    const teams = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).map((team) => ({
          kind: "team" as const,
          teamId: team.id,
          teamSlug: team.slug,
          href: `/settings/teams/${team.slug}`,
          label: team.name,
          subtitle: "Team I'm part of",
        })),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    const projects = (organizations ?? [])
      .flatMap((org) =>
        (org.teams ?? []).flatMap((team) =>
          (team.projects ?? []).map((project) => ({
            kind: "project" as const,
            projectId: project.id,
            projectSlug: project.slug,
            href: `/${project.slug}`,
            label: project.name,
            subtitle: "Project I work on",
          })),
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    return { personal, teams, projects };
  }, [organizations]);
}
