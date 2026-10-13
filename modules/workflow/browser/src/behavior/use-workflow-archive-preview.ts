import { evaluatorClient } from "@langwatch/evaluator-client";
import { monitorClient, type MonitorOutputs } from "@langwatch/monitor-client";

import { workflowApi } from "./workflow-api.ts";

type ProjectMonitor = MonitorOutputs["monitors"]["getAllForProject"][number];

/** The monitors a workflow's live evaluators back, which go when the evaluators do. */
function monitorsBackedBy({
  monitors,
  workflowId,
}: {
  monitors: readonly ProjectMonitor[];
  workflowId: string | undefined;
}): { id: string; name: string; evaluatorId: string }[] {
  return monitors.flatMap(({ id, name, evaluator }) =>
    evaluator !== null && evaluator.workflowId === workflowId && evaluator.archivedAt === null
      ? [{ id, name, evaluatorId: evaluator.id }]
      : [],
  );
}

/**
 * What deleting a workflow takes with it: its agents from workflow, the evaluators it backs
 * from evaluator and their monitors from monitor, each read from its owner.
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
  const evaluators = evaluatorClient.evaluators.listByWorkflow.useQuery(
    { workflowId: workflowId ?? "", projectId: projectId ?? "" },
    options,
  );
  const monitors = monitorClient.monitors.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    options,
  );

  const data = related.data
    ? {
        ...related.data,
        evaluators: evaluators.data ?? [],
        monitors: monitorsBackedBy({ monitors: monitors.data ?? [], workflowId }),
      }
    : undefined;

  return {
    data,
    isLoading: related.isLoading || evaluators.isLoading || monitors.isLoading,
  };
}
