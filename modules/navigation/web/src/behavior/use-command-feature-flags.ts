import { useMemo } from "react";
import { useNavigationHost } from "../model/navigation-host.ts";
import {
  type CommandFeatureFlagValues,
  filterCommandsByFeatureFlags,
  topLevelNavigationCommands,
} from "../model/command-catalogue.ts";
import type { Command } from "../model/command-bar-types.ts";

/** Flags for command list, asked through host so palette and sidebar see the same answer */
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
