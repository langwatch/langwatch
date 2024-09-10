import { useRouter } from "next/router";
import OptimizationStudio from "../../../optimization_studio/components/OptimizationStudio";
import { api } from "../../../utils/api";
import { useOrganizationTeamProject } from "../../../hooks/useOrganizationTeamProject";
import { useWorkflowStore } from "../../../optimization_studio/hooks/useWorkflowStore";
import { useEffect } from "react";
import type { Workflow } from "../../../optimization_studio/types/dsl";

export default function Studio() {
  const router = useRouter();
  const workflowId =
    typeof router.query.workflow === "string"
      ? router.query.workflow
      : undefined;
  const { project } = useOrganizationTeamProject();
  const workflow = api.workflow.getById.useQuery(
    { workflowId: workflowId ?? "", projectId: project?.id ?? "" },
    { enabled: !!project && !!workflowId, staleTime: Infinity }
  );

  const { reset, setWorkflow } = useWorkflowStore(({ reset, setWorkflow }) => ({
    reset,
    setWorkflow,
  }));
  const { clear } = useWorkflowStore.temporal.getState();

  useEffect(() => {
    const dsl = workflow.data?.latestVersion?.dsl as unknown as
      | Workflow
      | undefined;
    if (dsl) {
      setWorkflow({ ...dsl, workflowId: workflow.data?.id });
    } else {
      reset();
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!workflow.data]);

  return <OptimizationStudio />;
}
