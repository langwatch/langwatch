/**
 * Engine's streaming studio route on project's own Lambda; uses object storage for large payloads.
 */
import { createLogger } from "@langwatch/observability";
import { WorkflowExecutionFailedError } from "@langwatch/workflow-contract";

import {
  LWA_DEFAULT_STATUS,
  LWA_PRELUDE_SEPARATOR_LENGTH,
  findLwaPreludeSeparator,
  readLwaPreludeStatus,
} from "../rules/lambda-web-adapter-stream.rules.ts";
import { STUDIO_STAGING_PREFIX } from "../rules/nlp-lambda-config.rules.ts";
import { sealStagedPayload } from "../rules/staged-payload-seal.rules.ts";
import {
  type NlpLambdaFunctionReader,
  type NlpLambdaStreamInvoke,
  type NlpLambdaStreamChunk,
  type NlpPayloadStaging,
  STAGED_PAYLOAD_HEADER,
  STAGED_PAYLOAD_KEY_HEADER,
  type StagedNlpPayload,
  type WorkflowStudioStream,
  type WorkflowStudioStreamInput,
} from "./nlp-lambda.channel.ts";

const logger = createLogger("langwatch:workflow:studio-lambda-stream");

/** The Go engine's streaming studio route; it is what reads the staged header. */
const STUDIO_EXECUTE_PATH = "/go/studio/execute";

export type LambdaWorkflowStudioStreamOptions = Readonly<{
  functions: NlpLambdaFunctionReader;
  invoke: NlpLambdaStreamInvoke;
  /**
   * Where an oversized body is parked. Absent is a supported composition; an
   * oversized run then refuses by name instead of posting past AWS's byte
   * cap.
   */
  staging?: NlpPayloadStaging | undefined;
  stagingThresholdBytes: number;
  stagingTtlSeconds: number;
}>;

export class LambdaWorkflowStudioStreamChannel implements WorkflowStudioStream {
  static create(options: LambdaWorkflowStudioStreamOptions): LambdaWorkflowStudioStreamChannel {
    return new LambdaWorkflowStudioStreamChannel(options);
  }

  private constructor(private readonly options: LambdaWorkflowStudioStreamOptions) {}

  async open(input: WorkflowStudioStreamInput): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const functionArn = await this.options.functions.arnFor({ projectId: input.projectId });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LangWatch-Origin": input.origin,
    };
    const body = JSON.stringify(input.body);
    const parked = await this.stageIfOversized({
      projectId: input.projectId,
      body,
      headers,
    });
    const staged = parked?.payload;
    const payload = JSON.stringify({
      rawPath: STUDIO_EXECUTE_PATH,
      requestContext: { http: { method: "POST" } },
      headers: parked
        ? {
            ...headers,
            [STAGED_PAYLOAD_HEADER]: parked.payload.url,
            [STAGED_PAYLOAD_KEY_HEADER]: parked.key,
          }
        : headers,
      body: staged ? "" : body,
    });

    const abort = new AbortController();
    let frames: AsyncIterable<NlpLambdaStreamChunk>;
    try {
      frames = await this.options.invoke.invokeStream({
        functionArn,
        payload,
        signal: abort.signal,
      });
    } catch (error) {
      await discard(staged);
      throw error;
    }

    return readStudioFrames({ frames, staged, abort }).getReader();
  }

  /**
   * Decides against the SERIALIZED body: the invoke envelope embeds it as an
   * escaped string, so a body under the threshold can cross it once escaped.
   */
  private async stageIfOversized(input: {
    projectId: string;
    body: string;
    headers: Record<string, string>;
  }): Promise<{ payload: StagedNlpPayload; key: string } | undefined> {
    const bytes = Buffer.byteLength(input.body, "utf-8");
    if (bytes <= this.options.stagingThresholdBytes) return undefined;

    const staging = this.options.staging;
    if (!staging) {
      throw new WorkflowExecutionFailedError({
        reasons: [
          new Error(
            `This studio run's payload is ${bytes} bytes, over the ` +
              `${this.options.stagingThresholdBytes}-byte direct invoke limit, and this ` +
              "deployment composed no object storage to park it in.",
          ),
        ],
      });
    }

    const { sealed, key } = sealStagedPayload(Buffer.from(input.body, "utf-8"));
    const payload = await staging.stage({
      projectId: input.projectId,
      keyPrefix: `${STUDIO_STAGING_PREFIX}/${input.projectId}`,
      serialized: sealed,
      ttlSeconds: this.options.stagingTtlSeconds,
    });
    logger.info(
      { projectId: input.projectId, bytes, thresholdBytes: this.options.stagingThresholdBytes },
      "staged an oversized studio invoke payload",
    );

    return { payload, key };
  }
}

/**
 * The invocation's frames as the bytes Studio reads. The prelude is stripped
 * first: AWS often ships it in the same chunk as the first SSE frame, and
 * forwarded raw it drops the engine's first event — the connect heartbeat.
 */
function readStudioFrames(input: {
  frames: AsyncIterable<NlpLambdaStreamChunk>;
  staged: StagedNlpPayload | undefined;
  abort: AbortController;
}): ReadableStream<Uint8Array> {
  const { frames, staged, abort } = input;
  const framing = LambdaWebAdapterFraming.create();
  let failureBody = "";

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const frame of frames) {
          if (frame.kind === "failed") {
            throw new WorkflowExecutionFailedError({
              reasons: [new Error(`The NLP Lambda failed the studio run: ${frame.errorCode}`)],
            });
          }

          const bytes = framing.read(frame.bytes);
          if (bytes.length === 0) continue;

          if (isFailureStatus(framing.statusCode)) {
            failureBody += new TextDecoder().decode(bytes);
            continue;
          }
          controller.enqueue(new Uint8Array(bytes));
        }

        if (isFailureStatus(framing.statusCode)) {
          throw new WorkflowExecutionFailedError({
            reasons: [
              new Error(
                `The NLP Lambda answered the studio run with ${framing.statusCode}: ${failureBody.trim()}`,
              ),
            ],
          });
        }
        controller.close();
      } catch (error) {
        logger.error({ error }, "the studio run's Lambda stream failed");
        controller.error(error);
      } finally {
        // The engine has fetched the staged body by the time the stream ends.
        // Staged bodies carry customer data and provider credentials, so they
        // are dropped promptly; the bucket's lifecycle rule covers the crash.
        await discard(staged);
      }
    },
    async cancel() {
      abort.abort();
      await discard(staged);
    },
  });
}

function isFailureStatus(statusCode: number): boolean {
  return statusCode < 200 || statusCode >= 300;
}

async function discard(staged: StagedNlpPayload | undefined): Promise<void> {
  if (!staged) return;
  try {
    await staged.discard();
  } catch (error) {
    logger.warn({ error }, "could not drop the staged studio invoke payload");
  }
}

/** Allocates a new array holding `first` followed by `second`. */
function concatBytes(
  first: Uint8Array<ArrayBufferLike>,
  second: Uint8Array<ArrayBufferLike>,
): Uint8Array<ArrayBuffer> {
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);

  return merged;
}

/**
 * One response stream's Lambda Web Adapter framing state. `read` answers what Studio should
 * receive, which is nothing until the prelude is complete: AWS may split it across chunks.
 */
export class LambdaWebAdapterFraming {
  static create(): LambdaWebAdapterFraming {
    return new LambdaWebAdapterFraming();
  }

  private preludeRead = false;
  private buffered: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
  private status = LWA_DEFAULT_STATUS;

  private constructor() {}

  /** The status the prelude declared, or the legacy default until it is read. */
  get statusCode(): number {
    return this.status;
  }

  /** Whether the prelude has been seen; false at the end means a broken frame. */
  get preludeComplete(): boolean {
    return this.preludeRead;
  }

  read(chunk: Uint8Array<ArrayBufferLike>): Uint8Array<ArrayBufferLike> {
    if (this.preludeRead) {
      return chunk;
    }

    const merged = concatBytes(this.buffered, chunk);
    const separator = findLwaPreludeSeparator(merged);
    if (separator === -1) {
      this.buffered = merged;

      return new Uint8Array(0);
    }

    this.status = readLwaPreludeStatus(merged.slice(0, separator));
    this.preludeRead = true;
    this.buffered = new Uint8Array(0);

    return merged.slice(separator + LWA_PRELUDE_SEPARATOR_LENGTH);
  }
}
