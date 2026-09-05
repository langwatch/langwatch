/**
 * The Lambda transport the per-project NLP engine is reached through, and the store an
 * oversized invoke body is parked in while it is in flight. Ports rather than SDK calls: the
 * staging decision belongs to this feature, the transports to the deployment.
 */

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

export abstract class NlpLambdaInvokePort {
  abstract invoke(input: { functionArn: string; payload: string }): Promise<NlpLambdaInvokeResult>;
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

export abstract class NlpPayloadStagingPort {
  abstract stage(input: {
    projectId: string;
    /** The path segment the parked object is filed under. */
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
  }): Promise<StagedNlpPayload>;
}
