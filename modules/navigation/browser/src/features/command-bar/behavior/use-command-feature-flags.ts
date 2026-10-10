import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { type ProjectNavigation, projectNavigation } from "@langwatch/project-contract";
import { useMemo } from "react";

import { useNavigationHost } from "../../../model/navigation-host.ts";
import type { Command } from "../model/command-bar-types.ts";
import {
  type CommandFeatureFlagValues,
  filterCommandsByFeatureFlags,
  filterCommandsByProjectNavigation,
  topLevelNavigationCommands,
} from "../model/command-catalogue.ts";

/** Flags for command list, asked through host so palette and sidebar see the same answer */
export function useCommandFeatureFlags(): CommandFeatureFlagValues {
  const agentTesting = useNavigationHost().featureFlag(
    FrontendFlags.release_ui_agent_testing_v2_enabled,
  );

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

/**
 * What the current project's navigation shows; an organization page holds no project and
 * keeps all.
 */
export function useCommandProjectNavigation(): ProjectNavigation {
  const kind = useNavigationHost().project()?.kind;
  return useMemo(() => projectNavigation(kind), [kind]);
}
