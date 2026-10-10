import { useMemo } from "react";

import { api } from "../../behavior/trace-api.ts";
import { useTraceHost } from "../../behavior/trace-host.ts";
import { useOrganizationTeamProject } from "../../behavior/use-organization-team-project.ts";

/**
 * The project's score key names by id.
 */
export function useScoreNamesById(): Map<string, string> {
  const { project } = useOrganizationTeamProject();
  const traceHost = useTraceHost();
  const scoreKeys = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && traceHost.hasPermission("annotations:view") },
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const key of scoreKeys.data ?? []) map.set(key.id, key.name);
    return map;
  }, [scoreKeys.data]);
}
