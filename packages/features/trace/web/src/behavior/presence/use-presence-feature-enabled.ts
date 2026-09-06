import { useMemo } from "react";

import {
  resolvePresenceAvailability,
  type PresenceAvailability,
} from "@langwatch/presence-web/surfaces/presence-state";

import { useOrganizationTeamProject } from "../use-organization-team-project.ts";

/**
 * Whether multiplayer presence is enabled for the active project, read off the
 * scope the explorer is already mounted in. The rule itself is the presence
 * package's, so the account menu and the lens cannot disagree about it.
 */
export function usePresenceFeatureEnabled(): PresenceAvailability {
  const { organization, project } = useOrganizationTeamProject();

  return useMemo(
    () =>
      resolvePresenceAvailability({
        organizationPresenceEnabled: organization?.presenceEnabled,
        projectPresenceEnabled: project?.presenceEnabled,
      }),
    [organization, project],
  );
}
