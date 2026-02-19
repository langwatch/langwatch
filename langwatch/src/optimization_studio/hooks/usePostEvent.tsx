import { useCallback, useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { fetchSSE } from "~/utils/sse/fetchSSE";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { createLogger } from "../../utils/logger";
import type { BaseComponent } from "../types/dsl";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";
import { useWorkflowStore, type WorkflowStore } from "./useWorkflowStore";

const logger = createLogger("langwatch:wizard:usePostEvent");
let pythonDisconnectedTimeout: NodeJS.Timeout | null = null;

export const PostEventProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const { project } = useOrganizationTeamProject();
  const { setSocketStatus, socketStatus } = useWorkflowStore(
    useShallow((state) => ({
      setSocketStatus: state.setSocketStatus,
      socketStatus: state.socketStatus,
    })),
  );
  const { postEvent } = usePostEvent();

  useEffect(() => {
    if (!project) return;

    const pythonReconnect = () => {
      pythonDisconnectedTimeout = setTimeout(() => {
        setSocketStatus("connecting-python");
      }, 10_000);
    };

    const isAlive = () => {
      postEvent({ type: "is_alive", payload: {} });
      if (socketStatus === "connected" && !pythonDisconnectedTimeout) {
        pythonReconnect();
      }
    };

    const interval = setInterval(
      isAlive,
      socketStatus === "connecting-python" ? 5_000 : 30_000,
    );

    // Make the first call
    if (socketStatus === "disconnected") {
      isAlive();
      setSocketStatus("connecting-python");
    }

    return () => {
      clearInterval(interval);
    };
  }, [postEvent, project, setSocketStatus, socketStatus]);

  return <>{children}</>;
};

export const usePostEvent = () => {
  const { project } = useOrganizationTeamProject();
  const workflowStore = useWorkflowStore();
  const { socketStatus, setEvaluationState, setComponentExecutionState } =
    useWorkflowStore(
      useShallow((state) => ({
        socketStatus: state.socketStatus,
        setEvaluationState: state.setEvaluationState,
        setComponentExecutionState: state.setComponentExecutionState,
      })),
    );

  const handleServerMessage = useHandleServerMessage({
    workflowStore,
    alertOnComponent: () => void 0,
  });

  const [isLoading, setIsLoading] = useState(false);

  const postEvent = useCallback(
    (event: StudioClientEvent) => {
      if (!project) return;

      setIsLoading(true);

      const onError = (error: Error) => {
        // Show error to user
        toaster.create({
          title: "Failed to post message",
          description: error.message || "Unknown error",
          type: "error",
          duration: 5000,
          meta: { closable: true },
        });

        // Update evaluation state if relevant
        if (event.type === "execute_evaluation") {
          setEvaluationState({
            status: "error",
            run_id: undefined,
            error: error.message,
            timestamps: { finished_at: Date.now() },
          });
        }

        if (event.type === "execute_component") {
          setComponentExecutionState(event.payload.node_id, {
            status: "error",
            error: error.message,
            timestamps: { finished_at: Date.now() },
          });
        }
      };

      fetchSSE<StudioServerEvent>({
        endpoint: "/api/workflows/post_event",
        payload: { projectId: project.id, event },
        timeout: 20000,

        // Process each event
        onEvent: (serverEvent) => {
          // Log the event
          logger.info({ serverEvent, event }, "received message");

          // Handle the event with the workflow store
          handleServerMessage(serverEvent);

          // Handle evaluation errors
          if (
            serverEvent.type === "error" &&
            event.type === "execute_evaluation"
          ) {
            setEvaluationState({
              status: "error",
              run_id: undefined,
              error: serverEvent.payload.message,
              timestamps: { finished_at: Date.now() },
            });
          }
        },

        // Stop processing on error
        shouldStopProcessing: (serverEvent) => {
          return serverEvent.type === "error";
        },

        // Handle stream errors
        onError,
      })
        .catch(onError)
        .finally(() => {
          setIsLoading(false);
        });
    },
    [handleServerMessage, project, setEvaluationState],
  );

  return { postEvent, isLoading, socketStatus };
};

export const useHandleServerMessage = ({
  workflowStore,
  alertOnComponent,
}: {
  workflowStore: WorkflowStore;
  alertOnComponent: ({
    componentId,
    execution_state,
  }: {
    componentId: string;
    execution_state: BaseComponent["execution_state"];
  }) => void;
}) => {
  const {
    setSocketStatus,
    getWorkflow,
    setComponentExecutionState,
    setWorkflowExecutionState,
    setEvaluationState,
    setOptimizationState,
    checkIfUnreachableErrorMessage,
    stopWorkflowIfRunning,
    setSelectedNode,
    setPropertiesExpanded,
    setOpenResultsPanelRequest,
    playgroundOpen,
  } = workflowStore;

  const alertOnError = useCallback((message: string | undefined) => {
    if (
      !!message?.toLowerCase().includes("stopped") ||
      !!message?.toLowerCase().includes("interrupted")
    ) {
      toaster.create({
        title: "Stopped",
        description: message?.slice(0, 140),
        type: "info",
        meta: {
          closable: true,
        },
        duration: 3000,
      });
    } else {
      toaster.create({
        title: "Error",
        description: message?.slice(0, 140),
        type: "error",
        meta: {
          closable: true,
        },
        duration: 5000,
      });
    }
  }, []);

  return useCallback(
    (message: StudioServerEvent) => {
      switch (message.type) {
        case "is_alive_response":
          if (pythonDisconnectedTimeout) {
            clearTimeout(pythonDisconnectedTimeout);
            pythonDisconnectedTimeout = null;
          }
          logger.info("python is alive, setting status to connected");
          setSocketStatus("connected");
          break;
        case "component_state_change":
          const currentComponentState = getWorkflow().nodes.find(
            (node) => node.id === message.payload.component_id,
          )?.data.execution_state;
          setComponentExecutionState(
            message.payload.component_id,
            message.payload.execution_state,
          );

          if (message.payload.execution_state?.status === "error") {
            checkIfUnreachableErrorMessage(
              message.payload.execution_state.error,
            );
            alertOnComponent({
              componentId: message.payload.component_id,
              execution_state: message.payload.execution_state,
            });
          }

          if (
            !playgroundOpen &&
            message.payload.execution_state?.status !== "running" &&
            currentComponentState?.status !== "success" &&
            ((getWorkflow().state.execution?.status === "running" &&
              getWorkflow().state.execution?.until_node_id ===
                message.payload.component_id) ||
              getWorkflow().state.execution?.status !== "running")
          ) {
            setSelectedNode(message.payload.component_id);
            setPropertiesExpanded(true);
          }
          break;
        case "execution_state_change":
          setWorkflowExecutionState(message.payload.execution_state);
          if (message.payload.execution_state?.status === "error") {
            alertOnError(message.payload.execution_state.error);
            stopWorkflowIfRunning(message.payload.execution_state.error);
          }
          break;
        case "evaluation_run_change":
          const currentEvaluationRun = getWorkflow().state.evaluation;
          setEvaluationState(message.payload.evaluation_run);
          if (message.payload.evaluation_run?.status === "error") {
            alertOnError(message.payload.evaluation_run.error);
            if (currentEvaluationRun?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("evaluations");
              }, 500);
            }
          }
          break;
        case "optimization_state_change":
          const currentOptimizationState = getWorkflow().state.optimization;
          setOptimizationState(message.payload.optimization_state);
          if (message.payload.optimization_state?.status === "error") {
            alertOnError(message.payload.optimization_state.error);
            if (currentOptimizationState?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("optimizations");
              }, 500);
            }
          }
          break;
        case "error":
          checkIfUnreachableErrorMessage(message.payload.message);
          stopWorkflowIfRunning(message.payload.message);
          alertOnError(message.payload.message);
          break;
        case "debug":
          break;
        case "done":
          break;
        default:
          toaster.create({
            title: "Unknown message type on client",
            //@ts-expect-error
            description: message.type,
            type: "warning",
            meta: {
              closable: true,
            },
            duration: 5000,
          });
          break;
      }
    },
    [
      alertOnComponent,
      alertOnError,
      checkIfUnreachableErrorMessage,
      getWorkflow,
      playgroundOpen,
      setComponentExecutionState,
      setEvaluationState,
      setOpenResultsPanelRequest,
      setOptimizationState,
      setPropertiesExpanded,
      setSelectedNode,
      setSocketStatus,
      setWorkflowExecutionState,
      stopWorkflowIfRunning,
    ],
  );
};
