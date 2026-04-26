import { useMemo } from "react";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { useRouter } from "~/utils/compat/next-router";

import type {
  WorkspaceSwitcherCurrent,
  WorkspaceSwitcherProps,
} from "./WorkspaceSwitcher";

/**
 * Derive the WorkspaceSwitcher's `current` selection from the router pathname
 * + the user's resolved organization/team/project context. Lets any consumer
 * render `<WorkspaceSwitcher current={useWorkspaceCurrent(props)} />` (or rely
 * on the component's internal default) instead of threading a hardcoded value.
 *
 * Resolution order:
 *   1. /me, /me/* → personal
 *   2. /settings/teams/<slug> → team (matched by slug against the user's teams)
 *   3. /<project-slug>/... → project (matched via the OTP hook's resolved project)
 *   4. fallback → "unknown" (renders the "Choose workspace" trigger)
 *
 * Spec: specs/ai-gateway/governance/workspace-switcher.feature
 *       (scenarios under "Auto-detected current context from URL")
 */
export function useWorkspaceCurrent(
  switcher: Pick<WorkspaceSwitcherProps, "teams" | "projects">,
): WorkspaceSwitcherCurrent {
  const router = useRouter();
  const { project } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });

  return useMemo<WorkspaceSwitcherCurrent>(() => {
    const pathname = router.pathname || "/";

    if (pathname === "/me" || pathname.startsWith("/me/")) {
      return { kind: "personal" };
    }

    const teamSlugMatch = pathname.match(/^\/settings\/teams\/([^/]+)/);
    if (teamSlugMatch) {
      const slug = teamSlugMatch[1];
      const team = switcher.teams.find((t) => t.teamSlug === slug);
      if (team) return { kind: "team", teamId: team.teamId };
    }

    if (project) {
      const matched = switcher.projects.find(
        (p) => p.projectId === project.id,
      );
      if (matched) return { kind: "project", projectId: matched.projectId };
    }

    return { kind: "unknown" };
  }, [router.pathname, project, switcher.teams, switcher.projects]);
}
