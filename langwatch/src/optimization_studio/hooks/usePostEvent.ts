import { useCallback, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useOrganizationTeamProject } from "../../hooks/useOrganizationTeamProject";
import { useHandleServerMessage } from "./useSocketClient";
import { useWorkflowStore } from "./useWorkflowStore";
import type { StudioClientEvent, StudioServerEvent } from "../types/events";
import { createLogger } from "../../utils/logger";
import { toaster } from "../../components/ui/toaster";
import { fetchSSE } from "~/utils/sse/fetchSSE";

const logger = createLogger("langwatch:wizard:usePostEvent");

export const usePostEvent = () => {
  const { project } = useOrganizationTeamProject();
  const workflowStore = useWorkflowStore();
  const { setEvaluationState } = useWorkflowStore(
    useShallow((state) => ({
      setEvaluationState: state.setEvaluationState,
    }))
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
        onError: (error) => {
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
        },
      }).finally(() => {
        setIsLoading(false);
      });
    },
    [handleServerMessage, project, setEvaluationState]
  );

  return { postEvent, isLoading };
};
