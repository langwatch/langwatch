import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { getS3CacheKey } from "../../../../optimization_studio/server/addEnvs";
import * as Sentry from "@sentry/node";
import { invokeLambda } from "../../../../optimization_studio/server/lambda";
import { createLogger } from "../../../../utils/logger";

const logger = createLogger("langwatch:post_event");

export const studioBackendPostEvent = async ({
  projectId,
  message: message,
  onEvent,
}: {
  projectId: string;
  message: StudioClientEvent;
  onEvent: (event: StudioServerEvent) => void;
}) => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    const s3CacheKey = getS3CacheKey(projectId);

    reader = await invokeLambda(projectId, message, s3CacheKey);
  } catch (error) {
    if (
      (error as any)?.cause?.code === "ECONNREFUSED" ||
      (error as any)?.cause?.code === "ETIMEDOUTA"
    ) {
      throw new Error("Python runtime is unreachable");
    }
    if (
      (error as any)?.message === "fetch failed" &&
      (error as any)?.cause.code
    ) {
      throw new Error((error as any)?.cause.code);
    }
    throw error;
  }

  try {
    if (!reader) {
      throw new Error("No response body");
    }

    const decoder = new TextDecoder();
    const decodeChunk = (chunk: string) => {
      const events = chunk.split("\n\n").filter(Boolean);
      for (const event of events) {
        if (event.startsWith("data: ")) {
          try {
            const serverEvent: StudioServerEvent = JSON.parse(event.slice(6));
            onEvent(serverEvent);

            // Close the connection if we receive a completion event
            if (serverEvent.type === "done") {
              return;
            }
          } catch (error) {
            logger.error({ error, event }, "Failed to parse event");
            const error_ = new Error(
              `Failed to parse server event, please contact support`
            );
            Sentry.captureException(error_, { extra: { event } });
            throw error_;
          }
        }
      }
    };

    let chunksBuffer = "";
    let events = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      chunksBuffer += chunk;

      if (chunksBuffer.includes("\n\n")) {
        events++;
        const chunks = chunksBuffer.split("\n\n");
        const readyChunks = chunks.slice(0, -1).join("\n\n");
        decodeChunk(readyChunks);
        chunksBuffer = chunks[chunks.length - 1] ?? "";
      }
    }
    if (events === 0) {
      logger.error(
        { chunksBuffer },
        `Studio invalid response: ${chunksBuffer}`
      );
    }
  } catch (error) {
    logger.error({ error }, "Error reading stream");
    const node_id =
      "node_id" in message.payload ? message.payload.node_id : undefined;

    if (node_id) {
      onEvent({
        type: "component_state_change",
        payload: {
          component_id: node_id,
          execution_state: {
            status: "error",
            error: (error as Error).message,
            timestamps: { finished_at: Date.now() },
          },
        },
      });
    } else {
      onEvent({
        type: "error",
        payload: { message: (error as Error).message },
      });
    }
  } finally {
    reader?.releaseLock();
  }
};
