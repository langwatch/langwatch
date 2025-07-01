import { toaster } from "../../components/ui/toaster";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import type { StudioClientEvent } from "../types/events";
import { useWorkflowStore } from "./useWorkflowStore";
import { usePostEvent } from "./usePostEvent";

export const useEvaluationExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    run_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  const { getWorkflow, setEvaluationState, setOpenResultsPanelRequest } =
    useWorkflowStore((state) => ({
      getWorkflow: state.getWorkflow,
      setEvaluationState: state.setEvaluationState,
      setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
    }));

  const socketAvailable = useCallback(() => {
    if (socketStatus !== "connected") {
      toaster.create({
        title: "Studio is not connected",
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
      return false;
    }
    return true;
  }, [socketStatus]);

  useEffect(() => {
    const workflow = getWorkflow();
    if (
      triggerTimeout &&
      workflow.state.evaluation?.run_id === triggerTimeout.run_id &&
      workflow.state.evaluation?.status === triggerTimeout.timeout_on_status
    ) {
      setEvaluationState({
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      });
      toaster.create({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting"
            ? "starting"
            : "stopping"
        } evaluation execution`,
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    }
  }, [triggerTimeout, setEvaluationState, getWorkflow]);

  const startEvaluationExecution = useCallback(
    ({
      workflow_version_id,
      evaluate_on,
      dataset_entry,
    }: {
      workflow_version_id: string;
      evaluate_on: "full" | "test" | "train" | "specific";
      dataset_entry?: number;
    }) => {
      if (!socketAvailable()) {
        return;
      }

      const run_id = `run_${nanoid()}`;

      setOpenResultsPanelRequest("closed");
      setEvaluationState({
        status: "waiting",
        run_id,
        progress: 0,
        total: 0,
      });

      const payload: StudioClientEvent = {
        type: "execute_evaluation",
        payload: {
          run_id,
          workflow: getWorkflow(),
          workflow_version_id,
          evaluate_on,
          dataset_entry,
        },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({ run_id, timeout_on_status: "waiting" });
      }, 20_000);
    },
    [
      socketAvailable,
      setOpenResultsPanelRequest,
      setEvaluationState,
      getWorkflow,
      postEvent,
    ]
  );

  const stopEvaluationExecution = useCallback(
    ({ run_id }: { run_id: string }) => {
      if (!socketAvailable()) {
        return;
      }

      const workflow = getWorkflow();
      const current_state = workflow.state.evaluation?.status;
      if (current_state === "waiting") {
        setEvaluationState({
          status: "idle",
          run_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_evaluation_execution",
        payload: { workflow: workflow, run_id },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 10_000);
    },
    [socketAvailable, setEvaluationState, postEvent, getWorkflow]
  );

  return {
    startEvaluationExecution,
    stopEvaluationExecution,
  };
};
