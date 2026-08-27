import { useMemo } from "react";
import { useFeatureFlag } from "~/hooks/useFeatureFlag";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { NOT_TARGETED } from "@langwatch/feature-flag-contract";
import {
  type CommandFeatureFlagValues,
  filterCommandsByFeatureFlags,
  topLevelNavigationCommands,
} from "../command-registry";
import type { Command } from "../types";

/**
 * Release flags the command list reads.
 *
 * The read states the project and the organization it is about, so a rollout
 * written for either one reaches Quick Search exactly as it reaches the main
 * menu. A flag that has not answered yet is absent from the map.
 */
export function useCommandFeatureFlags(): CommandFeatureFlagValues {
  const { project, organization } = useOrganizationTeamProject({
    redirectToOnboarding: false,
    redirectToProjectOnboarding: false,
  });
  const agentTesting = useFeatureFlag("release_ui_agent_testing_v2_enabled", {
    projectId: project?.id,
    // Quick Search also opens on organization pages, which hold no project.
    organizationId: organization?.id ?? NOT_TARGETED,
    enabled: !!project?.id,
  });

  return useMemo(
    () => ({
      release_ui_agent_testing_v2_enabled: agentTesting.isLoading
        ? undefined
        : agentTesting.enabled,
    }),
    [agentTesting.isLoading, agentTesting.enabled],
  );
}

/**
 * The navigation commands offered on an empty bar, with the flagged ones
 * resolved for this person.
 */
export function useTopLevelNavigationCommands(): Command[] {
  const flags = useCommandFeatureFlags();

  return useMemo(
    () =>
      filterCommandsByFeatureFlags({
        commands: topLevelNavigationCommands,
        flags,
      }),
    [flags],
  );
}
