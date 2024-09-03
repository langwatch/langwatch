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

export const useSocketClient = () => {
  const { project } = useOrganizationTeamProject();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { socketStatus, setSocketStatus, setComponentExecutionState } =
    useWorkflowStore((state) => ({
      socketStatus: state.socketStatus,
      setSocketStatus: state.setSocketStatus,
      setComponentExecutionState: state.setComponentExecutionState,
    }));

  const toast = useToast();
  const alertOnComponent = useAlertOnComponent();

  const handleMessage = useCallback(
    (event: MessageEvent) => {
      const data: StudioServerEvent = JSON.parse(event.data);
      debug(data.type, "payload" in data ? data.payload : undefined);

      switch (data.type) {
        case "component_state_change":
          setComponentExecutionState(
            data.payload.component_id,
            data.payload.execution_state
          );
          if (data.payload.execution_state?.status === "error") {
            alertOnComponent({
              componentId: data.payload.component_id,
              execution_state: data.payload.execution_state,
            });
          }
          break;
        case "execution_state_change":
          // TODO
          break;
        case "error":
          toast({
            title: "Error",
            description: data.payload.message,
            status: "error",
            duration: 5000,
            isClosable: true,
          });
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
    [alertOnComponent, setComponentExecutionState, toast]
  );

  const connect = useCallback(() => {
    if (!project) return;

    if (socketInstance?.readyState === WebSocket.OPEN) return;

    setSocketStatus("connecting");
    // TODO: ws or wss?
    socketInstance = new WebSocket(
      `ws://${
        window.location.host
      }/api/studio/ws?projectId=${encodeURIComponent(project.id)}`
    );

    socketInstance.onopen = () => {
      setSocketStatus("connected");
    };

    socketInstance.onclose = () => {
      setSocketStatus("disconnected");
      scheduleReconnect();
    };

    socketInstance.onerror = (error) => {
      console.error("WebSocket error:", error);
      setSocketStatus("disconnected");
      scheduleReconnect();
    };

    socketInstance.onmessage = handleMessage;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, setSocketStatus]);

  useEffect(() => {
    if (socketInstance) {
      socketInstance.onmessage = handleMessage;
    }
  }, [handleMessage]);

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

  return {
    socketStatus,
    sendMessage,
    connect,
    disconnect,
  };
};
