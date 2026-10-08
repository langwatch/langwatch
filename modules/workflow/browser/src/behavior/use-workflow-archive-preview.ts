import { evaluatorClient } from "@langwatch/evaluator-client";

import { workflowApi } from "./workflow-api.ts";

/**
 * What deleting a workflow takes with it: its agents and monitors from workflow, the
 * evaluators it backs from evaluator. An evaluator read the reader may not make names none.
 */
export function useWorkflowArchivePreview({
  workflowId,
  projectId,
  enabled,
}: {
  workflowId: string | undefined;
  projectId: string | undefined;
  enabled: boolean;
}) {
  const options = { enabled: enabled && !!workflowId && !!projectId };
  const related = workflowApi.workflow.getRelatedEntities.useQuery(
    { workflowId: workflowId ?? "", projectId: projectId ?? "" },
    options,
  );
  const evaluators = evaluatorClient.evaluators.getAll.useQuery(
    { projectId: projectId ?? "" },
    options,
  );

  const data = related.data
    ? {
        ...related.data,
        evaluators: (evaluators.data ?? [])
          .filter((evaluator) => evaluator.workflowId === workflowId)
          .map(({ id, name }) => ({ id, name })),
      }
    : undefined;

  return { data, isLoading: related.isLoading || evaluators.isLoading };
}
