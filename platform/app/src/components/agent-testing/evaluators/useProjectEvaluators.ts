/**
 * The saved evaluators of the project, keyed by id, which is how an
 * attachment names the evaluator it runs.
 *
 * One read for every pill and every editor: the suite editor, the header
 * line and the run dialog all resolve an attachment through it.
 */

import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { AttachableEvaluator } from "./attachment-rules";

export function useProjectEvaluators({
  enabled = true,
}: {
  enabled?: boolean;
} = {}): {
  evaluatorsById: ReadonlyMap<string, AttachableEvaluator>;
  isLoading: boolean;
} {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";
  const { data, isLoading } = api.evaluators.getAll.useQuery(
    { projectId },
    { enabled: enabled && !!projectId },
  );

  const evaluatorsById = useMemo(() => {
    const byId = new Map<string, AttachableEvaluator>();
    for (const evaluator of data ?? []) byId.set(evaluator.id, evaluator);
    return byId;
  }, [data]);

  return { evaluatorsById, isLoading };
}
