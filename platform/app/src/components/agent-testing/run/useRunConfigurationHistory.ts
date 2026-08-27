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
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import {
  configurationsForScope,
  type RunConfigurationEntry,
  type RunScope,
} from "./run-configuration";

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
}): RunConfigurationEntry[] {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const { data: entries } = api.scenarios.getRunConfigurations.useQuery(
    { projectId },
    { enabled: isEnabled && !!projectId },
  );

  return useMemo(() => {
    if (!scope || !entries) return [];
    return configurationsForScope({ entries, scope });
  }, [entries, scope]);
}
