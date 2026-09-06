import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

/**
 * The project's score key names by id.
 *
 * Every key the project has ever had, not just the active ones: a score left
 * on a key that was since deactivated still has to read by name.
 */
export function useScoreNamesById(): Map<string, string> {
  const { project, hasPermission } = useOrganizationTeamProject();
  const scoreKeys = api.annotationScore.getAll.useQuery(
    { projectId: project?.id ?? "" },
    { enabled: !!project?.id && hasPermission("annotations:view") },
  );

  return useMemo(() => {
    const map = new Map<string, string>();
    for (const key of scoreKeys.data ?? []) map.set(key.id, key.name);
    return map;
  }, [scoreKeys.data]);
}
