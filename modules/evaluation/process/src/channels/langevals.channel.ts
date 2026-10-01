/**
 * langevals, as this module reaches it: one JSON POST, staged through object
 * storage when the body is over the deployment's threshold (Lambda-fronted
 * langevals caps a synchronous body at 6 MB).
 */

/**
 * The header the receiver reads the presigned URL from. Its readers are
 * langevals (`langevals/staged_payload.py`) and the Go engine.
 */
export const STAGED_PAYLOAD_HEADER = "X-Payload-S3-URL";

/** Which call this is: picks the hard cap and attributes the log line. */
export type LangevalsCallKind =
  | "evaluation"
  | "topic_clustering_batch"
  | "topic_clustering_incremental";

export class PayloadTooLargeError extends Error {
  readonly bytes: number;
  readonly limitBytes: number;
  readonly kind: LangevalsCallKind;

  constructor(input: { bytes: number; limitBytes: number; kind: LangevalsCallKind }) {
    super(
      `${input.kind} payload is ${input.bytes} bytes, exceeds configured cap of ${input.limitBytes} bytes`,
    );
    this.name = "PayloadTooLargeError";
    this.bytes = input.bytes;
    this.limitBytes = input.limitBytes;
    this.kind = input.kind;
  }
}

/** The staging policy and hard caps, from this module's config. */
export type LangevalsPostConfig = Readonly<{
  /** Unset disables staging entirely: every payload goes inline. */
  stagingThresholdBytes: number | undefined;
  stagingTtlSeconds: number;
  evaluationMaxPayloadBytes: number;
  topicClusteringMaxPayloadBytes: number;
}>;

/** One parked payload, as the caller needs it back to reference and to discard. */
export interface StagedLangevalsPayload {
  /** The presigned GET URL the receiver fetches the body from. */
  readonly url: string;
  /** Best-effort removal; a bucket lifecycle rule reaps what a crash leaves. */
  discard(): Promise<void>;
}

/** Where an over-threshold body is parked while its call is in flight. */
export interface LangevalsPayloadStaging {
  stage(input: {
    projectId: string;
    keyPrefix: string;
    serialized: Buffer;
    ttlSeconds: number;
    /** The upload runs before the call, so it spends the same deadline. */
    signal?: AbortSignal | undefined;
  }): Promise<StagedLangevalsPayload>;
}

export type LangevalsPost = Readonly<{
  url: string;
  body: unknown;
  /** Absent for a tenantless call, always posted inline: no project to stage under. */
  projectId?: string | undefined;
  kind: LangevalsCallKind;
  headers?: Readonly<Record<string, string>> | undefined;
  signal?: AbortSignal | undefined;
}>;

export interface LangevalsChannel {
  post(input: LangevalsPost): Promise<Response>;
}
