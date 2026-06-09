import { OrganizationUserRole, TeamUserRole } from "@prisma/client";
import { useCallback, useMemo } from "react";

import { useDrawer } from "~/hooks/useDrawer";
import { CLIENT_FLAG_STALE_TIME_MS } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRequiredSession } from "~/hooks/useRequiredSession";
import { api } from "~/utils/api";
import { useRouter } from "~/utils/compat/next-router";

import { buildProjectSwitchHref } from "../utils/routes";

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
 * The personal "My Workspace" entry is gated on the AI governance flag: it
 * only renders when at least one of the user's organizations has
 * `release_ui_ai_governance_enabled`, since /me 404s otherwise. Org-less
 * users (no organizations at all) still see it — it is their only context.
 *
 * Each team carries `canCreateProject` (org or team admin) which drives the
 * per-team "+ New project" affordance, wired here to the create-project
 * drawer.
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 */
export function useWorkspaceData(): Pick<
  WorkspaceSwitcherProps,
  "personal" | "teams" | "projects" | "onCreateProjectForTeam"
> {
  const { organizations, project: currentProject } =
    useOrganizationTeamProject({
      redirectToOnboarding: false,
      redirectToProjectOnboarding: false,
    });
  const { data: session } = useRequiredSession();
  const userId = session?.user?.id;
  const { openDrawer } = useDrawer();
  const router = useRouter();

  // Switching projects should keep the user on the equivalent view of the
  // target project instead of bouncing them home (the regression). Delegates
  // to the shared route resolver so the switcher and the legacy ProjectSelector
  // stay in lockstep. `homeFallback: "plain"` lands on the project home for
  // org-scoped, personal, and settings routes that have no per-project view.
  const buildProjectHref = useCallback(
    (targetSlug: string): string =>
      buildProjectSwitchHref({
        routePattern: router.pathname,
        resolvedPathname: router.asPath,
        currentProjectSlug: currentProject?.slug,
        targetSlug,
        homeFallback: "plain",
      }),
    [router.pathname, router.asPath, currentProject?.slug],
  );

  const organizationIds = useMemo(
    () => (organizations ?? []).map((org) => org.id),
    [organizations],
  );

  // The workspace switcher mounts on every page that renders a chrome
  // header, so this query would fire on each navigation + every window
  // refocus without caching. Mirror useFeatureFlag's policy: long
  // staleTime + no refetch on focus / reconnect — a full reload picks
  // up new flag state, which is what governance preview rollouts need.
  const governanceQuery =
    api.featureFlag.isEnabledForAnyOrganization.useQuery(
      {
        flag: "release_ui_ai_governance_enabled",
        organizationIds,
      },
      {
        enabled: organizationIds.length > 0,
        staleTime: CLIENT_FLAG_STALE_TIME_MS,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
      },
    );

  // Hide the personal entry only when the user has organizations and none of
  // them enable governance. Org-less users keep it — it is their only context.
  const showPersonal =
    organizationIds.length === 0 || (governanceQuery.data?.enabled ?? false);

  const onCreateProjectForTeam = useCallback(
    ({ teamId, orgId }: { teamId: string; orgId: string }) => {
      openDrawer("createProject", {
        navigateOnCreate: true,
        defaultTeamId: teamId,
        organizationId: orgId,
      });
    },
    [openDrawer],
  );

  const { teams, projects } = useMemo(() => {
    // Personal teams never render in the team list — the top-level
    // "My Workspace" entry already covers the caller's own one, and
    // every other user's belongs only to them. Cascades to projects
    // since the projects flatMap iterates this filtered team list.
    const isVisibleTeam = (team: { isPersonal?: boolean }) => !team.isPersonal;

    const teams = (organizations ?? [])
      .flatMap((org) => {
        const isOrgAdmin =
          org.members?.find((m) => m.userId === userId)?.role ===
          OrganizationUserRole.ADMIN;
        return (org.teams ?? []).filter(isVisibleTeam).map((team) => {
          const isTeamAdmin =
            team.members?.find((m) => m.userId === userId)?.role ===
            TeamUserRole.ADMIN;
          return {
            kind: "team" as const,
            teamId: team.id,
            teamSlug: team.slug,
            orgId: org.id,
            orgName: org.name,
            orgSlug: org.slug,
            href: `/settings/teams/${team.slug}`,
            label: team.name,
            canCreateProject: isOrgAdmin || isTeamAdmin,
          };
        });
      })
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
            href: buildProjectHref(project.slug),
            label: project.name,
          })),
        ),
      )
      .sort((a, b) => a.label.localeCompare(b.label));

    return { teams, projects };
  }, [organizations, userId, buildProjectHref]);

  const personal = showPersonal
    ? {
        kind: "personal" as const,
        href: "/me",
        label: "My Workspace",
        subtitle: "Personal usage, personal budget",
      }
    : undefined;

  return { personal, teams, projects, onCreateProjectForTeam };
}
