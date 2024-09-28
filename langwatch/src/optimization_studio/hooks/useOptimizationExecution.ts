import { useToast } from "@chakra-ui/react";
import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import type { StudioClientEvent } from "../types/events";
import { useSocketClient } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";
import type { OPTIMIZERS } from "../types/optimizers";

export const useOptimizationExecution = () => {
  const { sendMessage, socketStatus } = useSocketClient();

  const toast = useToast();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    run_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  const { getWorkflow, setOptimizationState, setOpenResultsPanelRequest } =
    useWorkflowStore((state) => ({
      getWorkflow: state.getWorkflow,
      setOptimizationState: state.setOptimizationState,
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
      workflow.state.optimization?.run_id === triggerTimeout.run_id &&
      workflow.state.optimization?.status === triggerTimeout.timeout_on_status
    ) {
      setOptimizationState({
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      });
      toast({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting"
            ? "starting"
            : "stopping"
        } optimization execution`,
        status: "error",
        duration: 5000,
        isClosable: true,
      });
    }
  }, [triggerTimeout, setOptimizationState, getWorkflow, toast]);

  const startOptimizationExecution = useCallback(
    ({
      workflow_version_id,
      optimizer,
      params,
    }: {
      workflow_version_id: string;
      optimizer: keyof typeof OPTIMIZERS;
      params: (typeof OPTIMIZERS)[keyof typeof OPTIMIZERS]["params"];
    }) => {
      if (!socketAvailable()) {
        return;
      }

      const run_id = `run_${nanoid()}`;

      setOpenResultsPanelRequest("closed");
      setOptimizationState({
        status: "waiting",
        run_id,
      });

      const payload: StudioClientEvent = {
        type: "execute_optimization",
        payload: {
          run_id,
          workflow: getWorkflow(),
          workflow_version_id,
          optimizer,
          params,
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
      setOptimizationState,
      getWorkflow,
      sendMessage,
    ]
  );

  const stopOptimizationExecution = useCallback(
    ({ run_id }: { run_id: string }) => {
      if (!socketAvailable()) {
        return;
      }

      const workflow = getWorkflow();
      const current_state = workflow.state.optimization?.status;
      if (current_state === "waiting") {
        setOptimizationState({
          status: "idle",
          run_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_optimization_execution",
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
    [socketAvailable, setOptimizationState, sendMessage, getWorkflow]
  );

  return {
    startOptimizationExecution,
    stopOptimizationExecution,
  };
};
