import { useToast } from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import type { StudioClientEvent } from "../types/events";
import { useSocketClient } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";

export const useEvaluationExecution = () => {
  const { sendMessage, socketStatus } = useSocketClient();

  const toast = useToast();

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
      toast({
        title: "Studio is not connected",
        status: "error",
        duration: 5000,
        isClosable: true,
      });
      return false;
    }
    return true;
  }, [socketStatus, toast]);

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
      toast({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting"
            ? "starting"
            : "stopping"
        } evaluation execution`,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  }, [triggerTimeout, setEvaluationState, getWorkflow, toast]);

  const startEvaluationExecution = useCallback(
    ({
      workflow_version_id,
      evaluate_on,
    }: {
      workflow_version_id: string;
      evaluate_on: "full" | "test" | "train";
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
        },
      };
      sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({ run_id, timeout_on_status: "waiting" });
      }, 10_000);
    },
    [
      socketAvailable,
      setOpenResultsPanelRequest,
      setEvaluationState,
      getWorkflow,
      sendMessage,
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
      sendMessage(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 5_000);
    },
    [socketAvailable, setEvaluationState, sendMessage, getWorkflow]
  );

  return {
    startEvaluationExecution,
    stopEvaluationExecution,
  };
};
