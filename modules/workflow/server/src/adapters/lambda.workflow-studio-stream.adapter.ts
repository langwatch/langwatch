/**
 * The engine's streaming studio route, reached on the project's OWN Lambda.
 *
 * This is the half the platform app wrapped its HTTP call in and that the
 * hostname-only adapter deliberately left behind: a per-project function
 * resolved by ARN, an oversized body parked in object storage rather than
 * posted over Lambda's 6 MiB invoke cap, and the Lambda Web Adapter's
 * RESPONSE_STREAM prelude stripped before the first SSE frame reaches Studio.
 *
 * Cancelling the reader aborts the invocation: a viewer who walks away must
 * stop the run, not leave it billing until the graph ends on its own.
 */
import { createLogger } from "@langwatch/observability";
import { WorkflowExecutionFailedError } from "@langwatch/workflow-contract";
import { NlpLambdaFunctionReader } from "../app/workflow.app.ts";
import {
  NlpLambdaStreamInvoke,
  type NlpLambdaStreamChunk,
} from "../app/workflow.app.ts";
import {
  NlpPayloadStaging,
  STAGED_PAYLOAD_HEADER,
  type StagedNlpPayload,
} from "../app/workflow.app.ts";
import {
  WorkflowStudioStream,
  type WorkflowStudioStreamInput,
} from "../app/workflow.app.ts";
import { STUDIO_STAGING_PREFIX } from "../rules/nlp-lambda-config.rules.ts";
import { LambdaWebAdapterStreamService } from "../services/lambda-web-adapter-stream.service.ts";

const logger = createLogger("langwatch:workflow:studio-lambda-stream");

/** The Go engine's streaming studio route; it is what reads the staged header. */
const STUDIO_EXECUTE_PATH = "/go/studio/execute";

export type LambdaWorkflowStudioStreamOptions = Readonly<{
  functions: NlpLambdaFunctionReader;
  invoke: NlpLambdaStreamInvoke;
  /**
   * Where an oversized body is parked. Absent is a supported composition — a
   * deployment with no object storage runs every studio graph that fits under
   * the cap — and an oversized run then refuses by name instead of posting
   * over the cap and reporting AWS's byte count.
   */
  staging?: NlpPayloadStaging | undefined;
  stagingThresholdBytes: number;
  stagingTtlSeconds: number;
}>;

export class LambdaWorkflowStudioStreamAdapter implements WorkflowStudioStream {
  static create(options: LambdaWorkflowStudioStreamOptions): LambdaWorkflowStudioStreamAdapter {
    return new LambdaWorkflowStudioStreamAdapter(options);
  }

  private constructor(private readonly options: LambdaWorkflowStudioStreamOptions) {}

  async open(input: WorkflowStudioStreamInput): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    const functionArn = await this.options.functions.arnFor({ projectId: input.projectId });
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-LangWatch-Origin": input.origin,
    };
    const body = JSON.stringify(input.body);
    const staged = await this.stageIfOversized({
      projectId: input.projectId,
      body,
      headers,
    });
    const payload = JSON.stringify({
      rawPath: STUDIO_EXECUTE_PATH,
      requestContext: { http: { method: "POST" } },
      headers: staged ? { ...headers, [STAGED_PAYLOAD_HEADER]: staged.url } : headers,
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
  }): Promise<StagedNlpPayload | undefined> {
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

    const staged = await staging.stage({
      projectId: input.projectId,
      keyPrefix: `${STUDIO_STAGING_PREFIX}/${input.projectId}`,
      serialized: Buffer.from(input.body, "utf-8"),
      ttlSeconds: this.options.stagingTtlSeconds,
    });
    logger.info(
      { projectId: input.projectId, bytes, thresholdBytes: this.options.stagingThresholdBytes },
      "staged an oversized studio invoke payload",
    );

    return staged;
  }
}

/**
 * The invocation's frames as the bytes Studio reads.
 *
 * The prelude is stripped before anything is enqueued: AWS commonly delivers
 * it in the same chunk as the first SSE frame, and forwarded raw it puts a
 * bare `{` where the parser expects `data: `, which drops the engine's first
 * event — the heartbeat Studio waits on before it says it is connected.
 */
function readStudioFrames(input: {
  frames: AsyncIterable<NlpLambdaStreamChunk>;
  staged: StagedNlpPayload | undefined;
  abort: AbortController;
}): ReadableStream<Uint8Array> {
  const { frames, staged, abort } = input;
  const framing = LambdaWebAdapterStreamService.create();
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
