import { nanoid } from "nanoid";
import { useCallback, useRef } from "react";
import { toaster } from "../../components/ui/toaster";
import type { StudioClientEvent } from "../types/events";
import { mergeLocalConfigsIntoDsl } from "../utils/mergeLocalConfigs";
import { usePostEvent } from "./usePostEvent";
import { useWorkflowStore } from "./useWorkflowStore";

export const useEvaluationExecution = () => {
  const { postEvent, socketStatus } = usePostEvent();

  const { getWorkflow, setEvaluationState, setOpenResultsPanelRequest } =
    useWorkflowStore((state) => ({
      getWorkflow: state.getWorkflow,
      setEvaluationState: state.setEvaluationState,
      setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
    }));

  const getWorkflowRef = useRef(getWorkflow);
  getWorkflowRef.current = getWorkflow;

  const setEvaluationStateRef = useRef(setEvaluationState);
  setEvaluationStateRef.current = setEvaluationState;

  const socketAvailable = useCallback(() => {
    if (socketStatus !== "connected") {
      toaster.create({
        title: "Studio is not connected yet",
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

  const scheduleTimeout = useCallback(
    ({
      run_id,
      timeout_on_status,
      delayMs,
    }: {
      run_id: string;
      timeout_on_status: "waiting" | "running";
      delayMs: number;
    }) => {
      setTimeout(() => {
        const workflow = getWorkflowRef.current();
        if (
          workflow.state.evaluation?.run_id === run_id &&
          workflow.state.evaluation?.status === timeout_on_status
        ) {
          setEvaluationStateRef.current({
            status: "error",
            error: "Timeout",
            timestamps: { finished_at: Date.now() },
          });
          toaster.create({
            title: `Timeout ${
              timeout_on_status === "waiting" ? "starting" : "stopping"
            } evaluation execution`,
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
        }
      }, delayMs);
    },
    [],
  );

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

      const workflow = getWorkflow();
      const payload: StudioClientEvent = {
        type: "execute_evaluation",
        payload: {
          run_id,
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          workflow_version_id,
          evaluate_on,
          dataset_entry,
        },
      };
      postEvent(payload);

      scheduleTimeout({
        run_id,
        timeout_on_status: "waiting",
        delayMs: 20_000,
      });
    },
    [
      socketAvailable,
      setOpenResultsPanelRequest,
      setEvaluationState,
      getWorkflow,
      postEvent,
      scheduleTimeout,
    ],
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
        payload: {
          workflow: {
            ...workflow,
            nodes: mergeLocalConfigsIntoDsl(workflow.nodes),
          },
          run_id,
        },
      };
      postEvent(payload);

      scheduleTimeout({
        run_id,
        timeout_on_status: "running",
        delayMs: 10_000,
      });
    },
    [socketAvailable, setEvaluationState, postEvent, getWorkflow, scheduleTimeout],
  );

  return {
    startEvaluationExecution,
    stopEvaluationExecution,
  };
};
