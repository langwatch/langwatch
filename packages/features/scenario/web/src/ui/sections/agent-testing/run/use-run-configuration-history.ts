/**
 * The configurations a scope already ran with, for the run name dropdown.
 * @see specs/features/agent-testing/run-dialog.feature
 * @see specs/features/agent-testing/run-configuration-history.feature
 */

import { useMemo } from "react";
import { useOrganizationTeamProject } from "../../../../behavior/use-organization-team-project";
import { api } from "../../../../behavior/scenario-api";
import {
  configurationsForScope,
  type RunConfigurationEntry,
  type RunScope,
} from "./run-configuration";

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

  const { data: entries } = api.scenarios.getRunConfigurations.useQuery(
    { projectId },
    { enabled: isEnabled && !!projectId },
  );

  const scoped = useMemo(() => {
    if (!scope || !entries) return [];
    return configurationsForScope({ entries, scope });
  }, [entries, scope]);

  return { entries: scoped, isLoaded: !!entries };
}
