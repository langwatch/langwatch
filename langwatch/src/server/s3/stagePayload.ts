import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";

import { createS3Client } from "../storage";
import { createLogger } from "../../utils/logger/server";

const logger = createLogger("langwatch:s3:stagePayload");

/**
 * Header carrying the presigned GET URL when a too-large payload is offloaded
 * to S3 instead of being inlined into a 6 MB-capped AWS Lambda invoke. The
 * receivers that fetch it are langevals (langevals/staged_payload.py) and the
 * Go engine (services/nlpgo/adapters/httpapi/staged_payload.go) — keep all
 * three in sync.
 */
export const STAGED_PAYLOAD_HEADER = "X-Payload-S3-URL";

export interface StagedObject {
  s3Client: Awaited<ReturnType<typeof createS3Client>>["s3Client"];
  s3Bucket: string;
  key: string;
  stagedUrl: string;
}

/**
 * Uploads `serialized` to S3 under `keyPrefix` and returns a presigned GET URL
 * valid for `ttlSeconds`. The caller passes the URL to the upstream via
 * {@link STAGED_PAYLOAD_HEADER} and is responsible for calling
 * {@link deleteStagedObject} once the upstream has consumed it.
 */
export async function stagePayloadToS3(input: {
  projectId: string;
  keyPrefix: string;
  serialized: Buffer;
  ttlSeconds: number;
}): Promise<StagedObject> {
  const { projectId, keyPrefix, serialized, ttlSeconds } = input;

  const { s3Client, s3Bucket } = await createS3Client(projectId);
  const key = `${keyPrefix}/${Date.now()}-${nanoid()}.json`;

  await s3Client.send(
    new PutObjectCommand({
      Bucket: s3Bucket,
      Key: key,
      Body: serialized,
      ContentType: "application/json",
    }),
  );

  logger.debug(
    { projectId, bucket: s3Bucket, key, bytes: serialized.byteLength },
    "uploaded staged payload to S3",
  );

  const stagedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: s3Bucket, Key: key }),
    { expiresIn: ttlSeconds },
  );

  return { s3Client, s3Bucket, key, stagedUrl };
}

/**
 * Best-effort delete of a staged object. Non-fatal on failure: a bucket
 * lifecycle rule on the staging prefix is the orphan/crash fallback. Staged
 * bodies carry customer trace data and provider credentials, so we delete as
 * soon as the upstream has fetched it rather than relying on the lifecycle
 * rule alone.
 */
export async function deleteStagedObject(args: {
  s3Client: StagedObject["s3Client"];
  s3Bucket: string;
  key: string;
  projectId: string;
}): Promise<void> {
  const { s3Client, s3Bucket, key, projectId } = args;
  try {
    await s3Client.send(new DeleteObjectCommand({ Bucket: s3Bucket, Key: key }));
    logger.debug(
      { projectId, bucket: s3Bucket, key },
      "deleted staged payload from S3 after use",
    );
  } catch (error) {
    logger.warn(
      { projectId, bucket: s3Bucket, key, error },
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

export { safeUrlHost };
