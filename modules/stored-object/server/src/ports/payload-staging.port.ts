/**
 * Where an oversized outbound payload is parked while its call is in flight.
 * langevals and the NLP engine sit behind Lambda's 6 MB synchronous body cap;
 * over the threshold the body is uploaded and a presigned GET URL sent instead.
 */

/** One parked payload, as the caller needs it back to reference and discard. */
export interface StagedPayload {
  /** The presigned GET URL the receiver fetches the body from. */
  readonly url: string;
  /**
   * Removes the parked object. Best-effort by contract: the caller always
   * asks, and a bucket lifecycle rule on the staging prefix is the fallback
   * for the crash paths where the ask never happens.
   */
  discard(): Promise<void>;
}

export abstract class PayloadStagingPort {
  abstract stage(input: {
    projectId: string;
    /** The path segment the parked object is filed under. */
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    /**
     * The caller's deadline. The upload runs BEFORE the call it is staging
     * for, so an unsignalled put would spend the whole deadline before an
     * abort could bite.
     */
    signal?: AbortSignal | undefined;
  }): Promise<StagedPayload>;
}
