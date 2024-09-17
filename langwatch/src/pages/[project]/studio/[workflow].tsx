import { useEffect } from "react";
import OptimizationStudio from "../../../optimization_studio/components/OptimizationStudio";
import { useLoadWorkflow } from "../../../optimization_studio/hooks/useLoadWorkflow";
import { useWorkflowStore } from "../../../optimization_studio/hooks/useWorkflowStore";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import ErrorPage from "next/error";

export default function Studio() {
  const { workflow } = useLoadWorkflow();

  const { reset, setWorkflow, setPreviousWorkflow } = useWorkflowStore(
    ({ reset, setWorkflow, setPreviousWorkflow }) => ({
      reset,
      setWorkflow,
      setPreviousWorkflow,
    })
  );
  const { clear } = useWorkflowStore.temporal.getState();

  useEffect(() => {
    const dsl = workflow.data?.currentVersion?.dsl as unknown as
      | Workflow
      | undefined;
    if (dsl) {
      // Prevent autosave from triggering after load
      setPreviousWorkflow(undefined);
      setWorkflow({ ...dsl, workflowId: workflow.data?.id });
    } else {
      reset();
      clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!workflow.data]);

  if (workflow.isFetched && !workflow.data) {
    return <ErrorPage statusCode={404} />;
  }

  return <OptimizationStudio />;
}