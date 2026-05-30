import { captureException } from "~/utils/posthogErrorCapture";
import { getS3CacheKey } from "../../../../optimization_studio/server/addEnvs";
import { invokeLambda } from "../../../../optimization_studio/server/lambda";
import { isNlpGoEnabled } from "~/server/nlpgo/nlpgoFetch";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { createLogger } from "../../../../utils/logger/server";
import { prisma } from "../../../../server/db";
import { stripUnsupportedLLMParamsFromWorkflow } from "../../../../server/workflows/stripUnsupportedLLMParams";

const logger = createLogger("langwatch:post_event");

/** Event types the Go engine handles natively when the FF is on. The
 *  only outlier is `execute_optimization`, intentionally rejected at
 *  the route layer with 410 (DSPy is gone). Studio fires `is_alive`
 *  every ~7s as a heartbeat and `stop_execution` when the user clicks
 *  Stop — if either of those still routes to the legacy
 *  `/studio/execute` path while the engine is on `/go/`, an operator
 *  running without the Python sidecar (the post-100% target topology)
 *  gets a perpetual "Connecting…" status plus a misleading "Bad Gateway
 *  child upstream unavailable" toast every heartbeat tick. So both
 *  passthrough types belong on the Go path; nlpgo answers them with
 *  bare SSE frames (see executeStreamHandler in
 *  services/nlpgo/adapters/httpapi/handlers.go). */
const GO_ENGINE_EVENT_TYPES = new Set([
  "execute_flow",
  "execute_component",
  "execute_evaluation",
  "is_alive",
  "stop_execution",
]);

export const studioBackendPostEvent = async ({
  projectId,
  message: message,
  onEvent,
  isAborted,
}: {
  projectId: string;
  message: StudioClientEvent;
  onEvent: (event: StudioServerEvent) => void;
  /** Optional function to check if execution should be aborted */
  isAborted?: () => Promise<boolean>;
}) => {
  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    // Dispatch chokepoint: strip every sampling param a node's model
    // does not list as supported (per project customModels + built-in
    // registry). Catches stale `top_p` etc on saved prompt-config
    // blobs that older edits left behind — Bedrock + others reject
    // mixed sampling knobs, so the previously-bug was a "stale field
    // sneaks into the dispatch" rather than a configuration error.
    // Runs for every event type that carries a workflow payload;
    // best-effort so a registry-lookup miss never blocks the run.
    if (
      "payload" in message &&
      message.payload &&
      typeof message.payload === "object" &&
      "workflow" in message.payload &&
      message.payload.workflow
    ) {
      try {
        await stripUnsupportedLLMParamsFromWorkflow({
          prisma,
          projectId,
          workflow: message.payload.workflow as Parameters<
            typeof stripUnsupportedLLMParamsFromWorkflow
          >[0]["workflow"],
        });
      } catch (filterError) {
        logger.warn(
          { err: filterError, projectId, eventType: message.type },
          "stripUnsupportedLLMParamsFromWorkflow failed; forwarding original payload",
        );
      }
    }

    const s3CacheKey = getS3CacheKey(projectId);

    const goEnabled =
      GO_ENGINE_EVENT_TYPES.has(message.type) &&
      (await isNlpGoEnabled({ projectId }));

    reader = await invokeLambda(projectId, message, s3CacheKey, {
      path: goEnabled ? "/go/studio/execute" : "/studio/execute",
      headers: goEnabled ? { "X-LangWatch-Origin": "workflow" } : undefined,
      // Only the Go engine fetches the X-Payload-S3-URL header; the legacy
      // Python handler inlines the body, so staging is gated to the Go path.
      supportsStaging: goEnabled,
    });
  } catch (error) {
    if (
      (error as any)?.cause?.code === "ECONNREFUSED" ||
      (error as any)?.cause?.code === "ETIMEDOUTA"
    ) {
      throw new Error("LangWatch NLP is unreachable");
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
            const message =
              (error as Error).message ?? "Failed to parse server event";
            logger.error({ error, event }, message);
            throw error;
          }
        }
      }
    };

    let chunksBuffer = "";
    let events = 0;
    while (true) {
      // Check abort before each read
      if (isAborted && (await isAborted())) {
        logger.info("Execution aborted, cancelling stream reader");
        await reader.cancel();
        break;
      }

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
    if (events === 0 && !(isAborted && (await isAborted()))) {
      throw new Error(`Studio invalid response: ${chunksBuffer}`);
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
