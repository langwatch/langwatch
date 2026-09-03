import { createLogger } from "@langwatch/observability";
import {
  LangevalsPayloadStagingPort,
  STAGED_PAYLOAD_HEADER,
} from "../ports/langevals-payload-staging.port";

const logger = createLogger("langwatch:langevals:stagedFetch");

const STAGING_PREFIX = "langevals-staging";

/**
 * The staged URL's host, for the log line. The HOST only: a presigned URL
 * carries its signature in the query string, so logging the whole thing would
 * put a credential in the log.
 */
function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

/**
 * Which langevals call path we're making. Drives:
 *   - the per-kind hard cap (eval vs topic clustering)
 *   - log attribution so we can split metrics in CloudWatch
 *
 * Adding a new kind is intentional friction — pick the right cap, don't
 * fall through to a generic default.
 */
export type LangevalsCallKind =
  | "evaluation"
  | "topic_clustering_batch"
  | "topic_clustering_incremental";

export class PayloadTooLargeError extends Error {
  constructor(
    public readonly bytes: number,
    public readonly limitBytes: number,
    public readonly kind: LangevalsCallKind,
  ) {
    super(`${kind} payload is ${bytes} bytes, exceeds configured cap of ${limitBytes} bytes`);
    this.name = "PayloadTooLargeError";
  }
}

export interface StagedFetchOptions {
  url: string;
  body: unknown;
  projectId: string;
  kind: LangevalsCallKind;
  headers?: Record<string, string>;
  /**
   * Optional client deadline / cancellation, forwarded verbatim to fetch().
   * Callers whose work is leased elsewhere (e.g. the topic-clustering outbox)
   * must bound the call below their lease, or a slow response outlives the
   * lease and a second replica re-runs the same work concurrently.
   */
  signal?: AbortSignal;
}

/**
 * The staging policy as a value, so a composed transport takes it from the
 * process configuration rather than reading the application environment.
 */
export type LangevalsStagedPayloadConfig = {
  /** Unset disables staging entirely: every payload goes inline. */
  stagingThresholdBytes: number | undefined;
  stagingTtlSeconds: number;
  evaluationMaxPayloadBytes: number;
  topicClusteringMaxPayloadBytes: number;
};

/**
 * Configured transport for callers composed at the application root.
 *
 * `staging` is optional and its absence is a SUPPORTED state rather than a
 * degradation: a self-hosted deployment talks to langevals over plain HTTP
 * with no 6 MB cap to dodge, so every payload goes inline and no object
 * storage is needed. A deployment that configured a staging threshold but
 * composed no staging refuses by name rather than silently posting a payload
 * the receiver will reject with a 413.
 */
export class LangevalsStagedPayloadClient {
  static create(input: {
    config: LangevalsStagedPayloadConfig;
    staging?: LangevalsPayloadStagingPort | undefined;
  }): LangevalsStagedPayloadClient {
    return new LangevalsStagedPayloadClient(input.config, input.staging);
  }

  private constructor(
    private readonly config: LangevalsStagedPayloadConfig,
    private readonly staging: LangevalsPayloadStagingPort | undefined,
  ) {}

  post(opts: StagedFetchOptions): Promise<Response> {
    return postStagedLangevalsPayload(opts, this.config, this.staging);
  }
}

/** The deployment configured staging but composed nowhere to stage to. */
export class LangevalsPayloadStagingUnavailableError extends Error {
  constructor(bytes: number, thresholdBytes: number) {
    super(
      `A ${bytes}-byte langevals payload is over this deployment's ${thresholdBytes}-byte ` +
        "staging threshold, but no payload staging was composed. Configure object " +
        "storage for staging, or unset the threshold to post every payload inline.",
    );
    this.name = "LangevalsPayloadStagingUnavailableError";
  }
}

function maxBytesForKind(kind: LangevalsCallKind, config: LangevalsStagedPayloadConfig): number {
  switch (kind) {
    case "evaluation":
      return config.evaluationMaxPayloadBytes;
    case "topic_clustering_batch":
    case "topic_clustering_incremental":
      return config.topicClusteringMaxPayloadBytes;
  }
}

/**
 * POST a JSON body to a langevals endpoint, auto-staging through the staging
 * port when the body exceeds the configured threshold.
 *
 * Why: langevals on SaaS is fronted by AWS Lambda whose sync request body is
 * capped at 6 MB. Topic clustering batches and long-input evaluators regularly
 * exceed that. Staging keeps the inbound request tiny (just the presigned URL
 * in a header) while the actual payload rides over object storage.
 *
 * Hard caps are per-kind and applied BEFORE any network call so we fail fast
 * with an actionable error rather than racing the upstream's 413.
 *
 * Returns the raw Response so callers keep full control over status / body
 * handling — same contract as a plain fetch().
 *
 * The free `stagedLangevalsFetch` that read four `LANGEVALS_*` variables off
 * the application environment is gone: the configuration is a value the
 * composition root supplies, and nothing imported that entrypoint.
 */
async function postStagedLangevalsPayload(
  opts: StagedFetchOptions,
  config: LangevalsStagedPayloadConfig,
  staging: LangevalsPayloadStagingPort | undefined,
): Promise<Response> {
  const { url, body, projectId, kind, headers = {}, signal } = opts;

  const serialized = Buffer.from(JSON.stringify(body), "utf-8");
  const bytes = serialized.byteLength;
  const limit = maxBytesForKind(kind, config);
  const threshold = config.stagingThresholdBytes;

  if (bytes > limit) {
    logger.error(
      { projectId, kind, bytes, limitBytes: limit, url },
      "langevals payload exceeds configured hard cap, rejecting before any network call",
    );
    throw new PayloadTooLargeError(bytes, limit, kind);
  }

  // Staging is opt-in: only enabled when LANGEVALS_STAGING_THRESHOLD_BYTES
  // is configured (SaaS / Lambda-fronted langevals). When unset (self-hosted
  // HTTP langevals), all payloads go inline regardless of size — there's no
  // 6 MB cap to dodge.
  if (threshold === undefined || bytes <= threshold) {
    logger.debug(
      { projectId, kind, bytes, thresholdBytes: threshold, url },
      threshold === undefined
        ? "posting langevals payload inline (staging disabled)"
        : "posting langevals payload inline (below staging threshold)",
    );
    return fetch(url, {
      method: "POST",
      // Content-Type is pinned last so callers can't override it: the
      // body is always JSON-serialized here, same contract as the
      // staged path below.
      headers: { ...headers, "Content-Type": "application/json" },
      body: serialized,
      ...(signal ? { signal } : {}),
    });
  }

  if (!staging) {
    throw new LangevalsPayloadStagingUnavailableError(bytes, threshold);
  }

  const ttlSeconds = config.stagingTtlSeconds;
  const staged = await staging.stage({
    projectId,
    keyPrefix: `${STAGING_PREFIX}/${projectId}/${kind}`,
    serialized,
    ttlSeconds,
    // The upload is part of the deadline-bounded exchange: it runs BEFORE
    // the fetch, so leaving it unsignalled would let a stalled put spend the
    // caller's whole deadline (and, for topic clustering, its lease) before
    // the abort could bite.
    ...(signal ? { signal } : {}),
  });

  logger.info(
    {
      projectId,
      kind,
      bytes,
      thresholdBytes: threshold,
      limitBytes: limit,
      ttlSeconds,
      stagedUrlHost: safeUrlHost(staged.url),
      target: url,
    },
    "staged large langevals payload via presigned S3 URL",
  );

  try {
    return await fetch(url, {
      method: "POST",
      // Caller headers are spread first so the contract-defining
      // X-Payload-S3-URL and Content-Type cannot be silently overridden;
      // letting a caller override the staged header would mean the
      // upstream Lambda fetches the wrong URL (or no URL at all).
      headers: {
        ...headers,
        "Content-Type": "application/json",
        [STAGED_PAYLOAD_HEADER]: staged.url,
      },
      ...(signal ? { signal } : {}),
    });
  } finally {
    // Best-effort delete: by the time fetch() resolves, langevals has
    // already fetched the presigned URL during its request handling, so
    // the object is no longer needed. Staged bodies carry customer trace
    // data and provider credentials (api keys, vertex_credentials,
    // bedrock keys) so we don't want them lingering. A bucket lifecycle
    // rule on the langevals-staging/ prefix is the orphan/crash fallback
    // for the failure paths where this delete can't run.
    await staged.discard();
  }
}
