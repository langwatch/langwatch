import { useCallback, useState } from "react";
import { toaster } from "../../../ui/toaster";
import { useOrganizationTeamProject } from "../../../../hooks/useOrganizationTeamProject";
import { useHandleServerMessage } from "../../../../optimization_studio/hooks/useSocketClient";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { useEvaluationWizardStore } from "./useEvaluationWizardStore";
import { getDebugger } from "../../../../utils/logger";

const DEBUGGING_ENABLED = true;

if (DEBUGGING_ENABLED) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require("debug").enable("langwatch:wizard:*");
}

const debug = getDebugger("langwatch:wizard:usePostEvent");

export const usePostEvent = () => {
  const { project } = useOrganizationTeamProject();
  const { workflowStore } = useEvaluationWizardStore(({ workflowStore }) => ({
    workflowStore,
  }));

  const handleServerMessage = useHandleServerMessage({
    workflowStore,
    alertOnComponent: () => void 0,
  });

  const [isLoading, setIsLoading] = useState(false);

  const handleTimeout = useCallback(() => {
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
  }, []);

  const postEvent = useCallback(
    (event: StudioClientEvent) => {
      if (!project) {
        return;
      }

      void (async () => {
        let timeout: NodeJS.Timeout | undefined;
        try {
          timeout = setTimeout(() => {
            handleTimeout();
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
            throw new Error(`Failed to post message: ${response.statusText}`);
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
            for (const event of events) {
              if (event.startsWith("data: ")) {
                const serverEvent: StudioServerEvent = JSON.parse(
                  event.slice(6)
                );
                debug("Received SSE event:", serverEvent);

                handleServerMessage(serverEvent);
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
        } finally {
          if (timeout) {
            clearTimeout(timeout);
          }
          setIsLoading(false);
        }
      })();
    },
    [project]
  );

  return { postEvent, isLoading };
};
