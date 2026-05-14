import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";

export type PresenceDisabledScope = "organization" | "project" | null;

export interface PresenceFeatureState {
  /** True when presence is allowed for the current project. */
  enabled: boolean;
  /** Which level disabled it (org wins over project), or null when enabled. */
  disabledAt: PresenceDisabledScope;
}

/**
 * Resolves whether multiplayer presence is enabled for the active project.
 * The org-level toggle is the global kill-switch — when it's off, the project
 * toggle is irrelevant. Loading states are treated as "enabled" so we don't
 * flash a disabled UI on first paint.
 */
export function usePresenceFeatureEnabled(): PresenceFeatureState {
  const { organization, project } = useOrganizationTeamProject();

  return useMemo(() => {
    if (organization && organization.presenceEnabled === false) {
      return { enabled: false, disabledAt: "organization" };
    }
    if (project && project.presenceEnabled === false) {
      return { enabled: false, disabledAt: "project" };
    }
    return { enabled: true, disabledAt: null };
  }, [organization, project]);
}
