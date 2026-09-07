import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import { toaster } from "@langwatch/ui-host/toaster";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import type { OPTIMIZERS } from "../../../model/optimizers.ts";
import { mergeLocalConfigsIntoDsl } from "@langwatch/workflow-contract";
import { usePostEvent } from "./use-post-event.tsx";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { nowInstant } from "@langwatch/time";

/** The timer this hook arms, naming the run and the state it timed out on. */
type OptimizationTimeoutTrigger = {
  run_id: string;
  timeout_on_status: "waiting" | "running";
};

/** Marks the run as timed out, if it is still in the state the timer was armed on. */
function applyOptimizationTimeout({
  getWorkflow,
  setOptimizationState,
  trigger,
}: {
  getWorkflow: () => { state: { optimization?: { run_id?: string; status?: string } } };
  setOptimizationState: (state: {
    status: "error";
    error: string;
    timestamps: { finished_at: number };
  }) => void;
  trigger: OptimizationTimeoutTrigger;
}) {
  const optimization = getWorkflow().state.optimization;
  const timedOutOnThisRun =
    optimization?.run_id === trigger.run_id && optimization?.status === trigger.timeout_on_status;
  if (!timedOutOnThisRun) return;

  setOptimizationState({
    status: "error",
    error: "Timeout",
    timestamps: { finished_at: nowInstant().epochMilliseconds },
  });
  const stage = trigger.timeout_on_status === "waiting" ? "starting" : "stopping";
  toaster.create({
    title: `Timeout ${stage} optimization execution`,
    type: "error",
    duration: 5000,
  });
}

export const useOptimizationExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

  const [triggerTimeout, setTriggerTimeout] = useState<OptimizationTimeoutTrigger | null>(null);

  const { getWorkflow, setOptimizationState, setOpenResultsPanelRequest } = useWorkflowStore(
    (state) => ({
      getWorkflow: state.getWorkflow,
      setOptimizationState: state.setOptimizationState,
      setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
    }),
  );

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
    if (!triggerTimeout) return;

    applyOptimizationTimeout({ getWorkflow, setOptimizationState, trigger: triggerTimeout });
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
    [socketAvailable, setOpenResultsPanelRequest, setOptimizationState, getWorkflow, postEvent],
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
