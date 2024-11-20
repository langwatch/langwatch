import { useToast } from "@chakra-ui/react";
import { useCallback, useEffect, useRef } from "react";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { getDebugger } from "../../utils/logger";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";
import { useAlertOnComponent } from "./useAlertOnComponent";
import { useWorkflowStore } from "./useWorkflowStore";

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

  const {
    socketStatus,
    setSocketStatus,
    setComponentExecutionState,
    setWorkflowExecutionState,
    setEvaluationState,
    setOptimizationState,
    getWorkflow,
    setSelectedNode,
    setPropertiesExpanded,
    setOpenResultsPanelRequest,
    playgroundOpen,
  } = useWorkflowStore((state) => ({
    socketStatus: state.socketStatus,
    setSocketStatus: state.setSocketStatus,
    setComponentExecutionState: state.setComponentExecutionState,
    setWorkflowExecutionState: state.setWorkflowExecutionState,
    setEvaluationState: state.setEvaluationState,
    setOptimizationState: state.setOptimizationState,
    getWorkflow: state.getWorkflow,
    setSelectedNode: state.setSelectedNode,
    setPropertiesExpanded: state.setPropertiesExpanded,
    setOpenResultsPanelRequest: state.setOpenResultsPanelRequest,
    playgroundOpen: state.playgroundOpen,
  }));

  const toast = useToast();
  const alertOnComponent = useAlertOnComponent();

  const checkIfUnreachableErrorMessage = useCallback(
    (message: string | undefined) => {
      if (
        socketStatus === "connected" &&
        message?.toLowerCase().includes("runtime is unreachable")
      ) {
        setSocketStatus("connecting-python");
      }
    },
    [socketStatus, setSocketStatus]
  );

  const stopWorkflowIfRunning = useCallback(
    (message: string | undefined) => {
      setWorkflowExecutionState({
        status: "error",
        error: message,
        timestamps: { finished_at: Date.now() },
      });
      for (const node of getWorkflow().nodes) {
        if (node.data.execution_state?.status === "running") {
          setComponentExecutionState(node.id, {
            status: "error",
            error: message,
            timestamps: { finished_at: Date.now() },
          });
        }
      }
    },
    [setWorkflowExecutionState, getWorkflow, setComponentExecutionState]
  );

  const alertOnError = useCallback(
    (message: string | undefined) => {
      if (
        !!message?.toLowerCase().includes("stopped") ||
        !!message?.toLowerCase().includes("interrupted")
      ) {
        toast({
          title: "Stopped",
          description: message?.slice(0, 140),
          status: "info",
          duration: 3000,
          isClosable: true,
        });
      } else {
        toast({
          title: "Error",
          description: message?.slice(0, 140),
          status: "error",
          duration: 5000,
          isClosable: true,
        });
      }
    },
    [toast]
  );

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data: StudioServerEvent = JSON.parse(event.data);
      debug(data.type, "payload" in data ? data.payload : undefined);

      switch (data.type) {
        case "is_alive_response":
          if (pythonDisconnectedTimeout) {
            clearTimeout(pythonDisconnectedTimeout);
            pythonDisconnectedTimeout = null;
          }
          setSocketStatus("connected");
          break;
        case "component_state_change":
          setComponentExecutionState(
            data.payload.component_id,
            data.payload.execution_state
          );
          if (data.payload.execution_state?.status === "error") {
            checkIfUnreachableErrorMessage(data.payload.execution_state.error);
            alertOnComponent({
              componentId: data.payload.component_id,
              execution_state: data.payload.execution_state,
            });
          }
          if (
            !playgroundOpen &&
            data.payload.execution_state?.status !== "running" &&
            ((getWorkflow().state.execution?.status === "running" &&
              getWorkflow().state.execution?.until_node_id ===
                data.payload.component_id) ||
              getWorkflow().state.execution?.status !== "running")
          ) {
            setSelectedNode(data.payload.component_id);
            setPropertiesExpanded(true);
          }
          break;
        case "execution_state_change":
          setWorkflowExecutionState(data.payload.execution_state);
          if (data.payload.execution_state?.status === "error") {
            alertOnError(data.payload.execution_state.error);
            stopWorkflowIfRunning(data.payload.execution_state.error);
          }
          break;
        case "evaluation_state_change":
          const currentEvaluationState = getWorkflow().state.evaluation;
          setEvaluationState(data.payload.evaluation_state);
          if (data.payload.evaluation_state?.status === "error") {
            alertOnError(data.payload.evaluation_state.error);
            if (currentEvaluationState?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("evaluations");
              }, 500);
            }
          }
          break;
        case "optimization_state_change":
          const currentOptimizationState = getWorkflow().state.optimization;
          setOptimizationState(data.payload.optimization_state);
          if (data.payload.optimization_state?.status === "error") {
            alertOnError(data.payload.optimization_state.error);
            if (currentOptimizationState?.status !== "waiting") {
              setTimeout(() => {
                setOpenResultsPanelRequest("optimizations");
              }, 500);
            }
          }
          break;
        case "error":
          checkIfUnreachableErrorMessage(data.payload.message);
          stopWorkflowIfRunning(data.payload.message);
          alertOnError(data.payload.message);
          break;
        case "debug":
          break;
        case "done":
          break;
        default:
          toast({
            title: "Unknown message type on client",
            //@ts-expect-error
            description: data.type,
            status: "warning",
            duration: 5000,
            isClosable: true,
          });
          break;
      }
    },
    [
      setSocketStatus,
      setComponentExecutionState,
      getWorkflow,
      setWorkflowExecutionState,
      setEvaluationState,
      setOptimizationState,
      checkIfUnreachableErrorMessage,
      stopWorkflowIfRunning,
      alertOnError,
      toast,
      alertOnComponent,
      setSelectedNode,
      setPropertiesExpanded,
      setOpenResultsPanelRequest,
      playgroundOpen,
    ]
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
      setTimeout(() => {
        if (socketInstance?.readyState === WebSocket.OPEN) return;
        setSocketStatus("disconnected");
        scheduleReconnect();
      }, 2000);
    };

    socketInstance.onerror = (error) => {
      console.error("WebSocket error:", error);
      setSocketStatus("disconnected");
      scheduleReconnect();
    };

    socketInstance.onmessage = handleMessage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, setSocketStatus]);

  const disconnect = useCallback(() => {
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
        if (!document.hasFocus()) {
          // Postpone 10 more seconds if tab is not focused
          sendMessage({ type: "is_alive", payload: {} });
          pythonReconnect();
          return;
        }

        setSocketStatus("connecting-python");
      }, 10_000);
    };

    const isAlive = () => {
      if (instanceId !== instances || !document.hasFocus()) return;
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
