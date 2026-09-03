/**
 * The configurations a scope already ran with, for the run name dropdown.
 *
 * The source is the runs themselves, read as one entry per configuration. A
 * plan row could only ever answer one entry per plan, because it holds the
 * configuration of its LAST run, while two runs of one plan that used
 * different parameters or a different repeat count are two configurations and
 * both belong in the list.
 *
 * The run NOTE is not part of a configuration and the read carries none.
 *
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
   *
   * What the dialog opens on comes from this read, so the dialog waits for it
   * rather than deciding on an empty list it is still waiting for.
   */
  isLoaded: boolean;
};

/**
 * The configurations of this scope, newest first.
 *
 * An empty list is the ordinary state of a scope that never ran, and the name
 * field reads as a plain input when it comes back empty.
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
