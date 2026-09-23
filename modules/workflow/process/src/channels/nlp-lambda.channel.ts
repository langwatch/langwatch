/**
 * The NLP engine's Lambda and streaming doors, as this module's services and
 * app reach them: one interface per conduit, implemented under `aws/` and `http/`.
 */
import type { StudioClientEvent, WorkflowRunOrigin } from "@langwatch/workflow-contract";

/** One project's resolved function, as the shared cache holds it. */
export type NlpLambdaArnEntry = Readonly<{
  arn: string;
  /** The deployment image it was resolved under; a change invalidates it. */
  imageUri: string;
}>;

/** The AWS flow that finds, creates or updates the project's function. */
export interface NlpLambdaArnResolver {
  resolve(input: { projectId: string; imageUri: string }): Promise<string>;
}

/**
 * Which function one project's engine answers on, as the caller needs it. The
 * resolution behind it is cached and single-flighted; a caller only asks.
 */
export interface NlpLambdaFunctionReader {
  arnFor(input: { projectId: string }): Promise<string>;
}

/** One frame off a streaming invoke. */
export type NlpLambdaStreamChunk =
  | Readonly<{ kind: "payload"; bytes: Uint8Array<ArrayBufferLike> }>
  /** AWS reports a handler failure as a terminal frame, not a rejection. */
  | Readonly<{ kind: "failed"; errorCode: string; details?: string | undefined }>;

export interface NlpLambdaStreamInvoke {
  /**
   * Opens the invocation. The signal aborts the call itself, so a viewer who
   * walks away stops the run rather than leaving it billing until it ends.
   */
  invokeStream(input: {
    functionArn: string;
    payload: string;
    signal?: AbortSignal | undefined;
  }): Promise<AsyncIterable<NlpLambdaStreamChunk>>;
}

/**
 * The header the receiver reads the presigned URL from. Its readers are
 * langevals (`langevals/staged_payload.py`), the Go engine
 * (`services/nlpgo/adapters/httpapi/staged_payload.go`) and this module.
 */
export const STAGED_PAYLOAD_HEADER = "X-Payload-S3-URL";

export type NlpLambdaInvokeResult = Readonly<{
  statusCode: number;
  /** AWS reports a handler failure here rather than as a non-2xx status. */
  functionError?: string | undefined;
  payload: string;
}>;

export interface NlpLambdaInvoke {
  invoke(input: { functionArn: string; payload: string }): Promise<NlpLambdaInvokeResult>;
}

/** One parked payload, as the caller needs it back to reference and discard. */
export interface StagedNlpPayload {
  /** The presigned GET URL the receiver fetches the body from. */
  readonly url: string;
  /**
   * Removes the parked object. Best-effort by contract: a bucket lifecycle
   * rule on the staging prefix is the fallback for the crash paths where the
   * ask never happens.
   */
  discard(): Promise<void>;
}

export interface NlpPayloadStaging {
  stage(input: {
    projectId: string;
    /** The path segment the parked object is filed under. */
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedNlpPayload>;
}

/** One STREAMING studio run, opened against the engine. */
export type WorkflowStudioStreamInput = {
  projectId: string;
  body: StudioClientEvent;
  origin: WorkflowRunOrigin;
};

/**
 * Engine's streaming studio route; separate from synchronous route because it streams continuously.
 */
export interface WorkflowStudioStream {
  open(input: WorkflowStudioStreamInput): Promise<ReadableStreamDefaultReader<Uint8Array>>;
}
