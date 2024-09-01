import { useEffect, useRef, useCallback } from "react";
import { useWorkflowStore } from "./useWorkflowStore";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";

let socketInstance: WebSocket | null = null;

const useStudioSocketConnection = () => {
  const { project } = useOrganizationTeamProject();
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { socketStatus, setSocketStatus } = useWorkflowStore((state) => ({
    socketStatus: state.socketStatus,
    setSocketStatus: state.setSocketStatus,
  }));

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

    socketInstance.onmessage = (event) => {
      // Handle incoming messages
      const data = JSON.parse(event.data);
      console.log("websocket data", data);
      // Update store or handle events based on data
    };
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

  const sendMessage = useCallback((event: string, data: any) => {
    if (socketInstance?.readyState === WebSocket.OPEN) {
      socketInstance.send(JSON.stringify({ event, data }));
    } else {
      console.error("Cannot send message: WebSocket is not connected");
    }
  }, []);

  return {
    status: socketStatus,
    sendMessage,
    connect,
    disconnect,
  };
};

export default useStudioSocketConnection;
