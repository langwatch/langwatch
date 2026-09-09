/**
 * Where a too-large langevals payload is parked while the call is in flight.
 *
 * langevals on SaaS is fronted by AWS Lambda, whose synchronous request body
 * is capped at 6 MB. Anything past the staging threshold is uploaded to object
 * storage and the request carries only a presigned GET URL in a header, which
 * the receiver fetches. The upload itself is object storage's business, not
 * topic clustering's, so it arrives as a port: a process that composes no
 * staging can still post every payload inline.
 *
 * The header's three readers are langevals (`langevals/staged_payload.py`),
 * the Go engine (`services/nlpgo/adapters/httpapi/staged_payload.go`) and this
 * module. Keep them in sync.
 */
export const STAGED_PAYLOAD_HEADER = "X-Payload-S3-URL";

/** One parked payload, as the caller needs it back to fetch and to discard it. */
export interface StagedLangevalsPayload {
  /** The presigned GET URL the receiver fetches the body from. */
  readonly url: string;
  /**
   * Removes the parked object. Best-effort by contract: staged bodies carry
   * customer trace data and provider credentials, so the caller always asks,
   * and a bucket lifecycle rule on the staging prefix is the fallback for the
   * crash paths where the ask never happens.
   */
  discard(): Promise<void>;
}

export abstract class LangevalsPayloadStagingPort {
  abstract stage(input: {
    projectId: string;
    /** The path segment the parked object is filed under. */
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    /**
     * The caller's deadline. The upload runs BEFORE the langevals call, so an
     * unsignalled put would spend the whole deadline — and, for topic
     * clustering, the whole lease — before an abort could bite.
     */
    signal?: AbortSignal | undefined;
  }): Promise<StagedLangevalsPayload>;
}
