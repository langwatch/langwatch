/**
 * The configurations a scope already ran with, for the run name dropdown.
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import { useOrganizationTeamProject } from "@langwatch/browser-host/use-organization-team-project";
import { scenarioClient } from "@langwatch/scenario-client";
import { parseSuiteTargets } from "@langwatch/suite-contract";
import { Temporal, toEpochMs } from "@langwatch/time";
import { useMemo } from "react";

import {
  configurationsForScope,
  type RunConfigurationEntry,
  type RunScope,
} from "./run-configuration.ts";

/** The configurations of one scope, and whether the read has answered yet. */
export type RunConfigurationHistory = {
  /** Newest first. Empty is the ordinary state of a scope that never ran. */
  entries: RunConfigurationEntry[];
  /**
   * Whether the read has answered.
   */
  isLoaded: boolean;
};

/**
 * The configurations of this scope, newest first.
 */
export function useRunConfigurationHistory({
  scope,
  isEnabled,
}: {
  scope: RunScope | null;
  isEnabled: boolean;
}): RunConfigurationHistory {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const { data: entries } = scenarioClient.scenarios.getRunConfigurations.useQuery(
    { projectId },
    { enabled: isEnabled && !!projectId },
  );

  const scoped = useMemo(() => {
    if (!scope || !entries) return [];
    const configurations = entries.map((entry) => ({
      ...entry,
      configuration: {
        ...entry.configuration,
        targets: parseSuiteTargets(entry.configuration.targets),
      },
      lastRunAt:
        entry.lastRunAt === null
          ? null
          : Temporal.Instant.fromEpochMilliseconds(toEpochMs(entry.lastRunAt)),
    }));
    return configurationsForScope({ entries: configurations, scope });
  }, [entries, scope]);

  return { entries: scoped, isLoaded: !!entries };
}
