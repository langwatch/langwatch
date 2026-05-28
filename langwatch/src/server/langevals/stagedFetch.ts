import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

import { env } from "../../env.mjs";
import { createS3Client } from "../storage";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:langevals:stagedFetch");

const STAGING_PREFIX = "langevals-staging";
const STAGED_HEADER = "X-Payload-S3-URL";

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
    super(
      `${kind} payload is ${bytes} bytes, exceeds configured cap of ${limitBytes} bytes`,
    );
    this.name = "PayloadTooLargeError";
  }
}

interface StagedFetchOptions {
  url: string;
  body: unknown;
  projectId: string;
  kind: LangevalsCallKind;
  headers?: Record<string, string>;
}

function maxBytesForKind(kind: LangevalsCallKind): number {
  switch (kind) {
    case "evaluation":
      return env.EVAL_MAX_PAYLOAD_BYTES;
    case "topic_clustering_batch":
    case "topic_clustering_incremental":
      return env.TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES;
  }
}

/**
 * POST a JSON body to a langevals endpoint, auto-staging via S3 +
 * presigned GET URL when the body exceeds LANGEVALS_STAGING_THRESHOLD_BYTES.
 *
 * Why: langevals on SaaS is fronted by AWS Lambda whose sync request body
 * is capped at 6 MB. Topic clustering batches and long-input evaluators
 * regularly exceed that. Staging keeps the inbound request tiny (just the
 * presigned URL in a header) while the actual payload rides over S3.
 *
 * Hard caps are per-kind and applied BEFORE any network call so we fail
 * fast with an actionable error rather than racing the upstream's 413.
 *
 * Returns the raw Response so callers keep full control over status / body
 * handling — same contract as a plain fetch().
 */
export async function stagedLangevalsFetch(
  opts: StagedFetchOptions,
): Promise<Response> {
  const { url, body, projectId, kind, headers = {} } = opts;

  const serialized = Buffer.from(JSON.stringify(body), "utf-8");
  const bytes = serialized.byteLength;
  const limit = maxBytesForKind(kind);
  const threshold = env.LANGEVALS_STAGING_THRESHOLD_BYTES;

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
    });
  }

  const ttlSeconds = env.LANGEVALS_STAGING_TTL_SECONDS;
  const { s3Client, s3Bucket, key, stagedUrl } = await stagePayload({
    projectId,
    kind,
    serialized,
    ttlSeconds,
  });

  logger.info(
    {
      projectId,
      kind,
      bytes,
      thresholdBytes: threshold,
      limitBytes: limit,
      ttlSeconds,
      stagedUrlHost: safeUrlHost(stagedUrl),
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
        [STAGED_HEADER]: stagedUrl,
      },
    });
  } finally {
    // Best-effort delete: by the time fetch() resolves, langevals has
    // already fetched the presigned URL during its request handling, so
    // the object is no longer needed. Staged bodies carry customer trace
    // data and provider credentials (api keys, vertex_credentials,
    // bedrock keys) so we don't want them lingering. A bucket lifecycle
    // rule on the langevals-staging/ prefix is the orphan/crash fallback
    // for the failure paths where this delete can't run.
    await deleteStagedObject({ s3Client, s3Bucket, key, projectId, kind });
  }
}

interface StagePayloadInput {
  projectId: string;
  kind: LangevalsCallKind;
  serialized: Buffer;
  ttlSeconds: number;
}

interface StagedObject {
  s3Client: Awaited<ReturnType<typeof createS3Client>>["s3Client"];
  s3Bucket: string;
  key: string;
  stagedUrl: string;
}

async function stagePayload(input: StagePayloadInput): Promise<StagedObject> {
  const { projectId, kind, serialized, ttlSeconds } = input;

  const { s3Client, s3Bucket } = await createS3Client(projectId);
  const key = `${STAGING_PREFIX}/${projectId}/${kind}/${Date.now()}-${nanoid()}.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: serialized,
      ContentType: "application/json",
    }),
  );

  logger.debug(
    { projectId, kind, bucket: s3Bucket, key, bytes: serialized.byteLength },
    "uploaded staged payload to S3",
  );

  const stagedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );

  return { s3Client, s3Bucket, key, stagedUrl };
}

async function deleteStagedObject(args: {
  s3Client: StagedObject["s3Client"];
  s3Bucket: string;
  key: string;
  projectId: string;
  kind: LangevalsCallKind;
}): Promise<void> {
  const { s3Client, s3Bucket, key, projectId, kind } = args;
  try {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }),
    );
    logger.debug(
      { projectId, kind, bucket: s3Bucket, key },
      "deleted staged payload from S3 after use",
    );
  } catch (error) {
    // Non-fatal: the lifecycle rule on langevals-staging/ will reap it.
    logger.warn(
      { projectId, kind, bucket: s3Bucket, key, error },
      "failed to delete staged payload from S3 (lifecycle rule will reap it)",
    );
  }
}

function safeUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}
