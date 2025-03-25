import { useCallback, useEffect, useRef } from "react";
import { toaster } from "../../components/ui/toaster";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getDebugger } from "../../utils/logger";
import type { BaseComponent } from "../types/dsl";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";
import { useAlertOnComponent } from "./useAlertOnComponent";
import { useWorkflowStore, type WorkflowStore } from "./useWorkflowStore";

const DEBUGGING_ENABLED = true;

if (DEBUGGING_ENABLED) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("debug").enable("langwatch:studio:*");
}

const debug = getDebugger("langwatch:studio:socket");

let socketInstance: WebSocket | null = null;
let pythonDisconnectedTimeout: NodeJS.Timeout | null = null;
let instances = 0;
let lastIsAliveCallTimestamp = 0;

export const useSocketClient = () => {
  instances++;
  const instanceId = instances;

  const { project } = useOrganizationTeamProject();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const workflowStore = useWorkflowStore();
  const { socketStatus, setSocketStatus } = workflowStore;
  const alertOnComponent = useAlertOnComponent();

  const handleServerMessage = useHandleServerMessage({
    workflowStore,
    alertOnComponent,
  });

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data: StudioServerEvent = JSON.parse(event.data);
      debug(data.type, "payload" in data ? data.payload : undefined);

      handleServerMessage(data);
    },
    [handleServerMessage]
  );

  const connect = useCallback(() => {
    if (!project) return;

    if (socketInstance?.readyState === WebSocket.OPEN) return;

    setSocketStatus("connecting-socket");
    socketInstance = new WebSocket(
      `${window.location.protocol === "https:" ? "wss" : "ws"}://${
        window.location.host
      }/api/studio/ws?projectId=${encodeURIComponent(project.id)}`
    );

    socketInstance.onopen = () => {
      debug("Socket opened, connecting to python");
      setSocketStatus((socketStatus) => {
        if (
          socketStatus === "disconnected" ||
          socketStatus === "connecting-socket"
        ) {
          lastIsAliveCallTimestamp = 0;
          return "connecting-python";
        }

        return socketStatus;
      });
    };

    socketInstance.onclose = () => {
      if (socketInstance?.readyState === WebSocket.OPEN) return;
      debug("Socket closed, reconnecting");
      setSocketStatus("disconnected");
      scheduleReconnect();
    };

    socketInstance.onerror = (error) => {
      debug("Socket error, reconnecting");
      console.error("WebSocket error:", error);
      setSocketStatus("disconnected");
      scheduleReconnect();
    };

    socketInstance.onmessage = handleMessage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, setSocketStatus]);

  const disconnect = useCallback(() => {
    debug("Socket disconnect triggered, closing socket");
    if (socketInstance) {
      socketInstance.close();
      socketInstance = null;
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    setSocketStatus("disconnected");
  }, [setSocketStatus]);

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) return;

    reconnectTimeoutRef.current = setTimeout(() => {
      reconnectTimeoutRef.current = null;
      connect();
    }, 5000); // Reconnect after 5 seconds
  }, [connect]);

  const sendMessage = useCallback((event: StudioClientEvent) => {
    if (socketInstance?.readyState === WebSocket.OPEN) {
      socketInstance.send(JSON.stringify(event));
    } else {
      console.error("Cannot send message: WebSocket is not connected");
    }
  }, []);

  useEffect(() => {
    if (instanceId !== instances) return;
    if (socketInstance) {
      socketInstance.onmessage = handleMessage;
    }
  }, [handleMessage, instanceId]);

  useEffect(() => {
    if (instanceId !== instances) return;

    const pythonReconnect = () => {
      pythonDisconnectedTimeout = setTimeout(() => {
        setSocketStatus("connecting-python");
      }, 10_000);
    };

    const isAlive = () => {
      if (instanceId !== instances) return;
      lastIsAliveCallTimestamp = Date.now();
      sendMessage({ type: "is_alive", payload: {} });
      if (socketStatus === "connected" && !pythonDisconnectedTimeout) {
        pythonReconnect();
      }
    };

    const interval = setInterval(
      isAlive,
      socketStatus === "connecting-python" ? 5_000 : 30_000
    );
    // Make the first call
    if (
      socketStatus === "connecting-python" &&
      Date.now() - lastIsAliveCallTimestamp > 5_000
    ) {
      isAlive();
    }

    return () => {
      clearInterval(interval);
    };
  }, [socketStatus, sendMessage, setSocketStatus, instanceId]);

  useEffect(() => {
    return () => {
      instances--;
    };
  }, []);

  return {
    socketStatus,
    sendMessage,
    connect,
    disconnect,
  };
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
          debug("Python is alive, setting status to connected");
          setSocketStatus("connected");
          break;
        case "component_state_change":
          const currentComponentState = getWorkflow().nodes.find(
            (node) => node.id === message.payload.component_id
          )?.data.execution_state;
          setComponentExecutionState(
            message.payload.component_id,
            message.payload.execution_state
          );

          if (message.payload.execution_state?.status === "error") {
            checkIfUnreachableErrorMessage(
              message.payload.execution_state.error
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
        case "evaluation_state_change":
          const currentEvaluationState = getWorkflow().state.evaluation;
          setEvaluationState(message.payload.evaluation_state);
          if (message.payload.evaluation_state?.status === "error") {
            alertOnError(message.payload.evaluation_state.error);
            if (currentEvaluationState?.status !== "waiting") {
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
    ]
  );
};
