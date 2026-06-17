/**
 * ADR-032 R3 (v6): heavy dataset files upload browser→S3 directly via a
 * presigned PUT to a server-owned staging key. The size cap is enforced at
 * *finalize* (HEAD the staged object) — no new dependency (uses the existing
 * `s3-request-presigner`). A POST-policy that rejects before bytes land
 * (`createPresignedPost`) is deferred hardening.
 *
 * Pure helpers (`stagingUploadKey`, `exceedsUploadCap`) are unit-tested; the
 * SDK wrappers (`createPresignedUpload`, `getStagedObjectSize`) are thin and
 * covered by the route's integration test.
 */
import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { nanoid } from "nanoid";
import { createS3Client } from "../storage";

/**
 * Hard upload size cap (~5 GiB). Above the 2–3 GB target use case; enforced at
 * finalize (HEAD + reject). Make env-driven / tighten later.
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Presigned PUT URLs are short-lived. */
export const UPLOAD_TTL_SECONDS = 15 * 60;

const assertNoTraversal = (...parts: string[]) => {
  for (const part of parts) {
    if (part.includes("..") || part.includes("/")) {
      throw new Error("Invalid id: path traversal attempt detected");
    }
  }
};

/**
 * Server-owned, tenant-scoped staging key the client cannot widen — the
 * presign is bound to exactly this key, so a client can only write this one
 * object under its own project prefix.
 */
export const stagingUploadKey = (
  projectId: string,
  uploadId: string,
): string => {
  assertNoTraversal(projectId, uploadId);
  return `staging/${projectId}/${uploadId}`;
};

/** True when a staged object exceeds the hard cap (checked at finalize). */
export const exceedsUploadCap = (
  sizeBytes: number,
  maxBytes: number = UPLOAD_MAX_BYTES,
): boolean => sizeBytes > maxBytes;

export type PresignedUpload = { uploadId: string; key: string; url: string };

/**
 * Mint a presigned PUT for a fresh upload. The key is generated server-side
 * (tenant-scoped staging prefix), so the client can only PUT that one object.
 */
export const createPresignedUpload = async ({
  projectId,
}: {
  projectId: string;
}): Promise<PresignedUpload> => {
  const uploadId = nanoid();
  const key = stagingUploadKey(projectId, uploadId);
  const { s3Client, s3Bucket } = await createS3Client(projectId);
  const url = await getSignedUrl(
    s3Client,
    new PutObjectCommand({ Bucket: s3Bucket, Key: key }),
    { expiresIn: UPLOAD_TTL_SECONDS },
  );
  return { uploadId, key, url };
};

/** HEAD the staged object to read its size — finalize size-cap enforcement. */
export const getStagedObjectSize = async ({
  projectId,
  key,
}: {
  projectId: string;
  key: string;
}): Promise<number> => {
  const { s3Client, s3Bucket } = await createS3Client(projectId);
  const head = await s3Client.send(
    new HeadObjectCommand({ Bucket: s3Bucket, Key: key }),
  );
  return head.ContentLength ?? 0;
};
