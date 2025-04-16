import { useCallback, useState } from "react";
import { toaster } from "../../../ui/toaster";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useHandleServerMessage } from "../../../../optimization_studio/hooks/useSocketClient";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { useEvaluationWizardStore } from "./evaluation-wizard-store/useEvaluationWizardStore";
import { getDebugger } from "../../../../utils/logger";

const DEBUGGING_ENABLED = true;

if (DEBUGGING_ENABLED) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("debug").enable("langwatch:wizard:*");
}

const debug = getDebugger("langwatch:wizard:usePostEvent");

export const usePostEvent = () => {
  const { project } = useOrganizationTeamProject();
  const { workflowStore, setEvaluationState } = useEvaluationWizardStore(
    ({ workflowStore }) => ({
      workflowStore,
      setEvaluationState: workflowStore.setEvaluationState,
    })
  );

  const handleServerMessage = useHandleServerMessage({
    workflowStore,
    alertOnComponent: () => void 0,
  });

  const [isLoading, setIsLoading] = useState(false);

  const handleTimeout = useCallback(
    (event: StudioClientEvent) => {
      console.error("Timeout");
      toaster.create({
        title: "Timeout",
        type: "error",
        duration: 5000,
        meta: {
          closable: true,
        },
      });
      setIsLoading(false);
      if (event.type === "execute_evaluation") {
        setEvaluationState({
          status: "error",
          run_id: undefined,
          error: "Timeout",
          timestamps: { finished_at: Date.now() },
        });
      }
    },
    [setEvaluationState]
  );

  const postEvent = useCallback(
    (event: StudioClientEvent) => {
      if (!project) {
        return;
      }

      void (async () => {
        let timeout: NodeJS.Timeout | undefined;
        try {
          timeout = setTimeout(() => {
            handleTimeout(event);
          }, 20_000);

          setIsLoading(true);

          // Using post_event endpoint which returns an SSE stream
          const response = await fetch("/api/workflows/post_event", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ projectId: project.id, event }),
          });

          if (!response.ok) {
            let responseJson: { error: string };
            try {
              responseJson = await response.json();
            } catch (error) {
              throw new Error(response.statusText);
            }
            throw new Error(responseJson.error);
          }

          // Process the SSE stream
          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error("No reader available in response");
          }

          // For parsing SSE events
          const decoder = new TextDecoder();
          let buffer = "";

          const processChunk = (chunk: string) => {
            const events = chunk.split("\n\n").filter(Boolean);
            for (const event_ of events) {
              if (event_.startsWith("data: ")) {
                const serverEvent: StudioServerEvent = JSON.parse(
                  event_.slice(6)
                );
                debug("Received SSE event:", serverEvent);

                if (timeout) {
                  clearTimeout(timeout);
                }

                handleServerMessage(serverEvent);
                if (serverEvent.type === "error") {
                  setIsLoading(false);
                  if (event.type === "execute_evaluation") {
                    setEvaluationState({
                      status: "error",
                      run_id: undefined,
                      error: serverEvent.payload.message,
                      timestamps: { finished_at: Date.now() },
                    });
                  }
                }
              }
            }
          };

          // Read the stream
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("SSE stream closed");
              break;
            }

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            if (buffer.includes("\n\n")) {
              const chunks = buffer.split("\n\n");
              const readyChunks = chunks.slice(0, -1).join("\n\n");
              processChunk(readyChunks);
              buffer = chunks[chunks.length - 1] ?? "";
            }
          }
        } catch (error) {
          console.error("Error processing SSE stream:", error);
          toaster.create({
            title: "Failed to post message",
            description:
              error instanceof Error ? error.message : "Unknown error",
            type: "error",
            duration: 5000,
            meta: {
              closable: true,
            },
          });
          if (event.type === "execute_evaluation") {
            setEvaluationState({
              status: "error",
              run_id: undefined,
              error: error instanceof Error ? error.message : "Unknown error",
              timestamps: { finished_at: Date.now() },
            });
          }
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
          setIsLoading(false);
        }
      })();
    },
    [handleServerMessage, handleTimeout, project, setEvaluationState]
  );

  return { postEvent, isLoading };
};
