import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { toaster } from "../../studio-host/toaster";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { OPTIMIZERS } from "@langwatch/workflow-web";
import { mergeLocalConfigsIntoDsl } from "@langwatch/workflow-contract";
import { usePostEvent } from "./usePostEvent";
import { useWorkflowStore } from "@langwatch/workflow-web";

export const useOptimizationExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

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
      toaster.create({
        title: "Studio is not connected yet",
        type: "error",
        duration: 5000,
      });
      return false;
    }
    return true;
  }, [socketStatus]);

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
      toaster.create({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting" ? "starting" : "stopping"
        } optimization execution`,
        type: "error",
        duration: 5000,
      });
    }
  }, [triggerTimeout, setOptimizationState, getWorkflow]);

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
        stdout: "",
      });

      const workflow = getWorkflow();
      const payload: StudioClientEvent = {
        type: "execute_optimization",
        payload: {
          run_id,
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          workflow_version_id,
          optimizer,
          params,
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
      setOptimizationState,
      getWorkflow,
      postEvent,
    ],
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
        payload: {
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          run_id,
        },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({
          run_id,
          timeout_on_status: "running",
        });
      }, 10_000);
    },
    [socketAvailable, setOptimizationState, postEvent, getWorkflow],
  );

  return {
    startOptimizationExecution,
    stopOptimizationExecution,
  };
};
