/**
 * A Lambda invocation whose answer arrives as it is produced.
 *
 * Separate from {@link NlpLambdaInvokePort} because it is a different
 * conversation rather than a different address: the buffered port answers once
 * with a status and a body, and a studio run answers continuously for as long
 * as the graph takes. A studio run buffered whole is a run nobody watches.
 */

/** One frame off a streaming invoke. */
export type NlpLambdaStreamChunk =
  | Readonly<{ kind: "payload"; bytes: Uint8Array<ArrayBufferLike> }>
  /** AWS reports a handler failure as a terminal frame, not a rejection. */
  | Readonly<{ kind: "failed"; errorCode: string; details?: string | undefined }>;

export abstract class NlpLambdaStreamInvokePort {
  /**
   * Opens the invocation. The signal aborts the call itself, so a viewer who
   * walks away stops the run rather than leaving it billing until it ends.
   */
  abstract invokeStream(input: {
    functionArn: string;
    payload: string;
    signal?: AbortSignal | undefined;
  }): Promise<AsyncIterable<NlpLambdaStreamChunk>>;
}
