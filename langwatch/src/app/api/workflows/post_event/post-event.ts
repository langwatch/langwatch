import { captureException } from "~/utils/posthogErrorCapture";
import { getS3CacheKey } from "../../../../optimization_studio/server/addEnvs";
import { invokeLambda } from "../../../../optimization_studio/server/lambda";
import type {
  StudioClientEvent,
  StudioServerEvent,
} from "../../../../optimization_studio/types/events";
import { createLogger } from "../../../../utils/logger/server";
import { prisma } from "../../../../server/db";
import { stripUnsupportedLLMParamsFromWorkflow } from "../../../../server/workflows/stripUnsupportedLLMParams";

const logger = createLogger("langwatch:post_event");

// How often to poll the abort flag while blocked on a stream read. The
// orchestrator signals abort through a Redis flag (no push), so an in-flight
// cell waiting on a slow LLM response only learns about an abort by polling.
// One second keeps the Stop button responsive without adding meaningful Redis
// load during normal streaming, where reads resolve well before this fires.
const ABORT_POLL_INTERVAL_MS = 1000;

/**
 * Reads the next stream chunk, resolving to "aborted" if an abort is requested
 * while the read is still pending. Without this an abort is only noticed
 * between chunks, so a cell blocked on a slow LLM response keeps running until
 * that response arrives. Cancelling the reader (the caller's job once this
 * returns "aborted") closes the connection to nlpgo, whose request context then
 * cancels the in-flight execution — the Go engine treats a client disconnect as
 * the cancel signal and has no separate in-process stop.
 */
const readChunkOrAbort = async (
  reader: ReadableStreamDefaultReader<Uint8Array>,
  isAborted?: () => Promise<boolean>,
): Promise<ReadableStreamReadResult<Uint8Array> | "aborted"> => {
  if (!isAborted) {
    return reader.read();
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  const abortPoll = new Promise<"aborted">((resolve) => {
    pollTimer = setInterval(() => {
      void isAborted().then((aborted) => {
        if (aborted) resolve("aborted");
      });
    }, ABORT_POLL_INTERVAL_MS);
  });

  try {
    return await Promise.race([reader.read(), abortPoll]);
  } finally {
    if (pollTimer) {
      clearInterval(pollTimer);
    }
  }
};

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

    reader = await invokeLambda(projectId, message, s3CacheKey, {
      path: "/go/studio/execute",
      headers: { "X-LangWatch-Origin": "workflow" },
      supportsStaging: true,
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

      // Race the read against the abort flag so a cell blocked on a slow LLM
      // response cancels promptly instead of only between chunks.
      const readResult = await readChunkOrAbort(reader, isAborted);
      if (readResult === "aborted") {
        logger.info("Execution aborted mid-read, cancelling stream reader");
        await reader.cancel();
        break;
      }
      const { done, value } = readResult;
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
