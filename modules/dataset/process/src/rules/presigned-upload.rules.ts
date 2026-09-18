/**
 * ADR-032 R3 (v6): pure policy for the heavy browser→storage direct upload.
 */
import { assertNoTraversal } from "@langwatch/dataset-contract";

/**
 * Hard upload size cap (~5 GiB). Above the 2–3 GB target use case; enforced at
 * finalize (HEAD + reject). Make env-driven / tighten later.
 */
export const UPLOAD_MAX_BYTES = 5 * 1024 * 1024 * 1024;

/** Presigned PUT URLs are short-lived. */
export const UPLOAD_TTL_SECONDS = 15 * 60;

/**
 * Age past which a `status='uploading'` row is treated as abandoned and reaped (its staging
 * object deleted, the row archived).
 */
export const STALE_PENDING_UPLOAD_TTL_SECONDS = 24 * 60 * 60;

/**
 * Age past which a `status='processing'` row is treated as wedged and its normalize re-driven.
 */
export const STALE_PROCESSING_TTL_SECONDS = 60 * 60;

/**
 * Server-owned, tenant-scoped staging key the client cannot widen — the
 * presign is bound to exactly this key, so a client can only write this one
 * object under its own project prefix.
 */
export const stagingUploadKey = (projectId: string, uploadId: string): string => {
  assertNoTraversal(projectId, uploadId);

  return `staging/${projectId}/${uploadId}`;
};

/**
 * Same-origin upload target for backends that deposit the staged object THROUGH the app rather
 * than via a cross-origin presigned PUT (local FS — no browser-reachable bucket). The browser
 * PUTs the raw file here and the route streams it to staging.
 */
export const localStagingUploadPath = (projectId: string, uploadId: string): string => {
  assertNoTraversal(projectId, uploadId);

  return `/api/dataset/direct-upload/staging/${uploadId}?projectId=${encodeURIComponent(
    projectId,
  )}`;
};

/** True when a staged object exceeds the hard cap (checked at finalize). */
export const exceedsUploadCap = (sizeBytes: number, maxBytes: number = UPLOAD_MAX_BYTES): boolean =>
  sizeBytes > maxBytes;
