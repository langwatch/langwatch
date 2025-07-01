import { nanoid } from "nanoid";
import { useCallback, useEffect, useState } from "react";
import type { StudioClientEvent } from "../types/events";
import { useWorkflowStore } from "./useWorkflowStore";
import { toaster } from "../../components/ui/toaster";
import { usePostEvent } from "./usePostEvent";

export const useWorkflowExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

  const [triggerTimeout, setTriggerTimeout] = useState<{
    trace_id: string;
    timeout_on_status: "waiting" | "running";
  } | null>(null);

  const { getWorkflow, setWorkflowExecutionState } = useWorkflowStore(
    (state) => ({
      getWorkflow: state.getWorkflow,
      setWorkflowExecutionState: state.setWorkflowExecutionState,
    })
  );

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
      workflow.state.execution?.trace_id === triggerTimeout.trace_id &&
      workflow.state.execution?.status === triggerTimeout.timeout_on_status
    ) {
      setWorkflowExecutionState({
        status: "error",
        error: "Timeout",
        timestamps: { finished_at: Date.now() },
      });
      toaster.create({
        title: `Timeout ${
          triggerTimeout.timeout_on_status === "waiting"
            ? "starting"
            : "stopping"
        } workflow execution`,
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
    }
  }, [triggerTimeout, setWorkflowExecutionState, getWorkflow]);

  const startWorkflowExecution = useCallback(
    ({
      untilNodeId,
      inputs,
    }: {
      untilNodeId?: string;
      inputs?: Array<Record<string, string>>;
    }) => {
      if (!socketAvailable()) {
        return;
      }

      const trace_id = `trace_${nanoid()}`;

      setWorkflowExecutionState({
        status: "waiting",
        trace_id,
        until_node_id: untilNodeId,
      });

      const payload: StudioClientEvent = {
        type: "execute_flow",
        payload: {
          trace_id,
          workflow: getWorkflow(),
          until_node_id: untilNodeId,
          inputs: inputs,
          manual_execution_mode: true,
        },
      };
      postEvent(payload);

      setTimeout(() => {
        setTriggerTimeout({ trace_id, timeout_on_status: "waiting" });
      }, 20_000);
    },
    [socketAvailable, getWorkflow, postEvent, setWorkflowExecutionState]
  );

  const stopWorkflowExecution = useCallback(
    ({ trace_id }: { trace_id: string }) => {
      if (!socketAvailable()) {
        return;
      }

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
    [socketAvailable, setWorkflowExecutionState, postEvent, getWorkflow]
  );

  return {
    startWorkflowExecution,
    stopWorkflowExecution,
  };
};
