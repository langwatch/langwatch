/**
 * ADR-032 R3 (v6): pure policy for the heavy browser→storage direct upload.
 *
 * Heavy files upload directly to a server-owned staging key; the size cap is
 * enforced at *finalize* (HEAD the staged object) — no new dependency (the S3
 * impl uses the already-installed `s3-request-presigner`). A POST-policy that
 * rejects before bytes land (`createPresignedPost`) is deferred hardening.
 *
 * This module is deliberately provider-agnostic: it owns only the staging-key
 * scheme, the size cap and the presign TTL. The SDK wrappers (presigned PUT,
 * HEAD, delete) live in `S3DatasetStorage`, which composes these helpers.
 */
import { assertNoTraversal } from "./dataset-chunking";

/**
 * Hard upload size cap (~5 GiB). Above the 2–3 GB target use case; enforced at
 * finalize (HEAD + reject). Make env-driven / tighten later.
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Presigned PUT URLs are short-lived. */
export const UPLOAD_TTL_SECONDS = 15 * 60;

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

/**
 * Same-origin upload target for backends that deposit the staged object THROUGH
 * the app rather than via a cross-origin presigned PUT (local FS — no
 * browser-reachable bucket). The browser PUTs the raw file here and the route
 * streams it to staging. Relative on purpose: the modal's PUT helper reads the
 * leading "/" as "same-origin → send the session cookie" (vs an absolute S3 URL
 * → no credentials). Shared by `LocalDatasetStorage.createPresignedUpload` (mints
 * it) and the `/direct-upload/staging/:uploadId` route (serves it).
 */
export const localStagingUploadPath = (
  projectId: string,
  uploadId: string,
): string => {
  assertNoTraversal(projectId, uploadId);
  return `/api/dataset/direct-upload/staging/${uploadId}?projectId=${encodeURIComponent(
    projectId,
  )}`;
};

/** True when a staged object exceeds the hard cap (checked at finalize). */
export const exceedsUploadCap = (
  sizeBytes: number,
  maxBytes: number = UPLOAD_MAX_BYTES,
): boolean => sizeBytes > maxBytes;
