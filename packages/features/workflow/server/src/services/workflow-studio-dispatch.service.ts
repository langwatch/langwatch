/**
 * One studio run, dispatched to the engine and streamed back event by event.
 */
import { createLogger } from "@langwatch/observability";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type {
  StudioClientEvent,
  StudioServerEvent,
  StudioWorkflow,
  WorkflowRunOrigin,
} from "@langwatch/workflow-contract";
import type { WorkflowStudioStreamPort } from "../ports/workflow.port";
import { WorkflowNlpExecutionService } from "./workflow-nlp-execution.service";

const logger = createLogger("langwatch:workflows:studio-dispatch");

/**
 * How often the abort flag is polled while a read is still pending. The orchestrator signals an
 * abort through a Redis flag rather than a push, so a cell blocked on a slow model response
 * only learns about one by asking.
 */
const ABORT_POLL_INTERVAL_MS = 1000;

/** One chunk off the engine's stream, or the end of it. */
type StreamRead = { done: boolean; value?: Uint8Array | undefined };

/** One studio event, dispatched and streamed. */
export type WorkflowStudioDispatchInput = Readonly<{
  projectId: string;
  event: StudioClientEvent;
  onEvent(event: StudioServerEvent): void;
  /** Asked before and during every read; absent means the run cannot be stopped. */
  isAborted?: () => Promise<boolean>;
  origin?: WorkflowRunOrigin;
}>;

export class WorkflowStudioDispatchService {
  static create(options: {
    stream: WorkflowStudioStreamPort;
    modelProviders: ModelProviderService;
  }): WorkflowStudioDispatchService {
    return new WorkflowStudioDispatchService(options);
  }

  private constructor(
    private readonly options: {
      stream: WorkflowStudioStreamPort;
      modelProviders: ModelProviderService;
    },
  ) {}

  async postEvent(input: WorkflowStudioDispatchInput): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      await this.stripUnsupportedParams(input);
      reader = await this.options.stream.open({
        projectId: input.projectId,
        body: input.event,
        origin: input.origin ?? "workflow",
      });
    } catch (error) {
      throw asReachabilityError(error);
    }

    try {
      await this.readStream(reader, input);
    } catch (error) {
      logger.error({ error }, "Error reading stream");
      reportAsStudioEvent(error, input);
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Strips every sampling parameter a node's model does not list as supported. The dispatch is
   * the chokepoint on purpose: a saved prompt-config blob an older edit left a stale `top_p` on
   * is rejected by Bedrock and several others, and the author has no way to see it.
   */
  private async stripUnsupportedParams(input: WorkflowStudioDispatchInput): Promise<void> {
    const workflow = studioWorkflowOf(input.event);
    if (!workflow) {
      return;
    }

    try {
      const providers = await this.options.modelProviders.getForProject({
        projectId: input.projectId,
      });
      WorkflowNlpExecutionService.stripUnsupportedParams(providers, workflow);
    } catch (error) {
      logger.warn(
        { err: error, projectId: input.projectId, eventType: input.event.type },
        "stripUnsupportedParams failed; forwarding original payload",
      );
    }
  }

  /**
   * The engine's server-sent events, decoded as they arrive. Frames are separated by a blank
   * line, so a chunk is buffered until it holds one and the trailing partial frame is carried
   * into the next read.
   */
  private async readStream(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    input: WorkflowStudioDispatchInput,
  ): Promise<void> {
    const decoder = new TextDecoder();
    const isAborted = input.isAborted;
    let buffered = "";
    let frames = 0;

    for (;;) {
      if (isAborted && (await isAborted())) {
        logger.info("Execution aborted, cancelling stream reader");
        await reader.cancel();

        return;
      }

      const read = await readChunkOrAbort(reader, isAborted);
      if (read === "aborted") {
        logger.info("Execution aborted mid-read, cancelling stream reader");
        await reader.cancel();

        return;
      }

      if (read.done || !read.value) {
        break;
      }

      buffered += decoder.decode(read.value, { stream: true });
      if (!buffered.includes("\n\n")) {
        continue;
      }

      frames++;
      const chunks = buffered.split("\n\n");
      const ready = chunks.slice(0, -1).join("\n\n");
      buffered = chunks[chunks.length - 1] ?? "";
      if (this.emitFrames(ready, input.onEvent)) {
        return;
      }
    }

    if (frames === 0 && !(isAborted && (await isAborted()))) {
      throw new Error(`Studio invalid response: ${buffered}`);
    }
  }

  /** Emits every `data:` frame in one chunk. True once the engine said `done`. */
  private emitFrames(chunk: string, onEvent: (event: StudioServerEvent) => void): boolean {
    for (const frame of chunk.split("\n\n").filter(Boolean)) {
      if (!frame.startsWith("data: ")) {
        continue;
      }

      let event: StudioServerEvent;
      try {
        event = JSON.parse(frame.slice(6)) as StudioServerEvent;
      } catch (error) {
        const message = (error as Error).message ?? "Failed to parse server event";
        logger.error({ error, event: frame }, message);

        throw error;
      }

      onEvent(event);
      if (event.type === "done") {
        return true;
      }
    }

    return false;
  }
}

/** The workflow a studio event carries, or none where it carries no graph. */
function studioWorkflowOf(event: StudioClientEvent): StudioWorkflow | null {
  const payload = "payload" in event ? (event.payload as Record<string, unknown>) : null;
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const workflow = payload.workflow;
  if (!workflow || typeof workflow !== "object") {
    return null;
  }

  return workflow as StudioWorkflow;
}

/**
 * A connection failure, named as one. A refused or timed-out socket reaches here as `fetch
 * failed` with the real reason on `cause.code`, which is unreadable in a toast.
 */
function asReachabilityError(error: unknown): Error {
  const cause = (error as { cause?: { code?: string } } | null)?.cause;
  if (cause?.code === "ECONNREFUSED" || cause?.code === "ETIMEDOUT") {
    return new Error("LangWatch NLP is unreachable");
  }

  if ((error as { message?: string } | null)?.message === "fetch failed" && cause?.code) {
    return new Error(cause.code);
  }

  return error instanceof Error ? error : new Error(String(error));
}

/** Reports a stream failure to the watcher as the studio event it is. */
function reportAsStudioEvent(error: unknown, input: WorkflowStudioDispatchInput): void {
  const message = (error as Error).message;
  const payload = "payload" in input.event ? (input.event.payload as Record<string, unknown>) : {};
  const nodeId = typeof payload?.node_id === "string" ? payload.node_id : undefined;

  if (nodeId) {
    input.onEvent({
      type: "component_state_change",
      payload: {
        component_id: nodeId,
        execution_state: {
          status: "error",
          error: message,
          timestamps: { finished_at: Date.now() },
        },
      },
    } as StudioServerEvent);

    return;
  }

  input.onEvent({ type: "error", payload: { message } } as StudioServerEvent);
}

/**
 * Reads the next chunk, resolving to `"aborted"` if an abort is requested while the read is
 * still pending. Without the race an abort is only noticed BETWEEN chunks, so a cell blocked on
 * a slow model response keeps running until that response arrives.
 */
async function readChunkOrAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  isAborted?: () => Promise<boolean>,
): Promise<StreamRead | "aborted"> {
  if (!isAborted) {
    return reader.read() as Promise<StreamRead>;
  }

  let poll: ReturnType<typeof setInterval> | undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    poll = setInterval(() => {
      void isAborted().then((stop) => {
        if (stop) {
          resolve("aborted");
        }
      });
    }, ABORT_POLL_INTERVAL_MS);
  });

  try {
    return await Promise.race([reader.read() as Promise<StreamRead>, aborted]);
  } finally {
    if (poll) {
      clearInterval(poll);
    }
  }
}
