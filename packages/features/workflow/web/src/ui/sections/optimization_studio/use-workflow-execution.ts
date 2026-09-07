import { createLogger } from "@langwatch/observability";
import { useCallback, useEffect, useState } from "react";
import { toaster } from "@langwatch/ui-host/toaster";
import { generateOtelTraceId } from "@langwatch/trace-contract";
import type { StudioClientEvent } from "@langwatch/workflow-contract";
import { mergeLocalConfigsIntoDsl } from "@langwatch/workflow-contract";
import { usePostEvent } from "./use-post-event.tsx";
import { useWorkflowStore } from "../../../behavior/use-workflow-store.ts";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:studio:execution");

/** The timer this hook arms, naming the trace and the state it timed out on. */
type WorkflowTimeoutTrigger = {
  trace_id: string;
  timeout_on_status: "waiting" | "running";
};

/** Marks the execution as timed out, if it is still in the state the timer was armed on. */
function applyWorkflowTimeout({
  getWorkflow,
  setWorkflowExecutionState,
  trigger,
}: {
  getWorkflow: () => { state: { execution?: { trace_id?: string; status?: string } } };
  setWorkflowExecutionState: (state: {
    status: "error";
    error: string;
    timestamps: { finished_at: number };
  }) => void;
  trigger: WorkflowTimeoutTrigger;
}) {
  const execution = getWorkflow().state.execution;
  const timedOutOnThisTrace =
    execution?.trace_id === trigger.trace_id && execution?.status === trigger.timeout_on_status;
  if (!timedOutOnThisTrace) return;

  logger.warn(
    {
      trace_id: trigger.trace_id,
      timeout_on_status: trigger.timeout_on_status,
    },
    "workflow execution timeout triggered",
  );
  setWorkflowExecutionState({
    status: "error",
    error: "Timeout",
    timestamps: { finished_at: nowInstant().epochMilliseconds },
  });
  const stage = trigger.timeout_on_status === "waiting" ? "starting" : "stopping";
  toaster.create({
    title: `Timeout ${stage} workflow execution`,
    type: "error",
    duration: 5000,
  });
}

export const useWorkflowExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

  const [triggerTimeout, setTriggerTimeout] = useState<WorkflowTimeoutTrigger | null>(null);

  const { getWorkflow, setWorkflowExecutionState } = useWorkflowStore((state) => ({
    getWorkflow: state.getWorkflow,
    setWorkflowExecutionState: state.setWorkflowExecutionState,
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
    if (!triggerTimeout) return;

    applyWorkflowTimeout({ getWorkflow, setWorkflowExecutionState, trigger: triggerTimeout });
  }, [triggerTimeout, setWorkflowExecutionState, getWorkflow]);

  const startWorkflowExecution = useCallback(
    ({ untilNodeId, inputs }: { untilNodeId?: string; inputs?: Array<Record<string, string>> }) => {
      if (!socketAvailable()) {
        return;
      }

      const trace_id = generateOtelTraceId();
      logger.info({ trace_id, untilNodeId }, "workflow execution starting");

      setWorkflowExecutionState({
        status: "waiting",
        trace_id,
        until_node_id: untilNodeId,
      });

      const workflow = getWorkflow();
      const payload: StudioClientEvent = {
        type: "execute_flow",
        payload: {
          trace_id,
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          until_node_id: untilNodeId,
          inputs: inputs,
          manual_execution_mode: true,
          origin: "workflow",
        },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({ trace_id, timeout_on_status: "waiting" });
      }, 20_000);
    },
    [socketAvailable, getWorkflow, postEvent, setWorkflowExecutionState],
  );

  const stopWorkflowExecution = useCallback(
    ({ trace_id }: { trace_id: string }) => {
      if (!socketAvailable()) {
        return;
      }

      logger.info({ trace_id }, "workflow execution stopping");

      const workflow = getWorkflow();
      const current_state = workflow.state.execution?.status;
      if (current_state === "waiting") {
        setWorkflowExecutionState({
          status: "idle",
          trace_id: undefined,
        });
        return;
      }

      const payload: StudioClientEvent = {
        type: "stop_execution",
        payload: { trace_id },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({
          trace_id,
          timeout_on_status: "running",
        });
      }, 10_000);
    },
    [socketAvailable, setWorkflowExecutionState, postEvent, getWorkflow],
  );

  return {
    startWorkflowExecution,
    stopWorkflowExecution,
  };
};
