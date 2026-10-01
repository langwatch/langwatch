import { useWorkflowHost } from "@langwatch/workflow-browser-kit";

import { workflowApi } from "../workflow-api.ts";

export function useStudioModelProviders() {
  const projectId = useWorkflowHost().scope().projectId;
  return workflowApi.modelProvider.getAllForProject.useQuery(
    { projectId: projectId ?? "" },
    { enabled: !!projectId },
  ).data;
}
