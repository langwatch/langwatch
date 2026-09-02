import { useMemo } from "react";
import { useNavigationHost } from "../model/navigation-host";
import {
  type CommandFeatureFlagValues,
  filterCommandsByFeatureFlags,
  topLevelNavigationCommands,
} from "../model/command-catalogue";
import type { Command } from "../model/command-bar-types";

/**
 * Release flags the command list reads.
 *
 * ASKED THROUGH THE HOST, which is what makes a rollout reach Quick Search
 * exactly as it reaches the main menu: the port answers one flag for the scope
 * the application already resolved, so the palette and the sidebar are looking
 * at the same answer rather than at two reads that can disagree. A flag that
 * has not answered yet is absent from the map, and a command that needs it
 * stays out of the list until it does.
 */
export function useCommandFeatureFlags(): CommandFeatureFlagValues {
  const agentTesting = useNavigationHost().featureFlag("release_ui_agent_testing_v2_enabled");

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
