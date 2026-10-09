import { useMemo } from "react";

import { useNavigationHost } from "../../../model/navigation-host.ts";
import type { Command } from "../model/command-bar-types.ts";
import {
  type CommandFeatureFlagValues,
  filterCommandsByFeatureFlags,
  filterCommandsByProjectNavigation,
  topLevelNavigationCommands,
} from "../model/command-catalogue.ts";
import { useCommandProjectNavigation } from "./use-command-project-navigation.ts";

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
 * resolved for this person and the sections this project's navigation hides left out.
 */
export function useTopLevelNavigationCommands(): Command[] {
  const flags = useCommandFeatureFlags();
  const navigation = useCommandProjectNavigation();

  return useMemo(
    () =>
      filterCommandsByProjectNavigation({
        commands: filterCommandsByFeatureFlags({ commands: topLevelNavigationCommands, flags }),
        navigation,
      }),
    [flags, navigation],
  );
}
