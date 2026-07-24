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
 * Age past which a `status='uploading'` row is treated as abandoned and reaped
 * (its staging object deleted, the row archived). Deliberately FAR above the
 * presign TTL: a row that lingers this long means the browser PUT either never
 * happened or completed-but-never-finalized, never a still-in-flight upload (a
 * legit upload starts within the 15-min presign window and finalizes promptly).
 * The conservative margin guarantees the lazy sweep never reaps a live upload.
 *
 * The reaper is *poll-triggered* (runs opportunistically when the next upload
 * starts — see `reapStalePendingUploads`), not a scheduler: this epic
 * deliberately adds no new cron/BullMQ-repeat (see the normalize-recovery
 * decision). The durable backstop for objects whose row never gets reaped (an
 * inactive project) is an S3 bucket lifecycle rule on the `staging/` prefix
 * (IaC) — the same place the upload-bucket CORS rule lives.
 */
export const STALE_PENDING_UPLOAD_TTL_SECONDS = 24 * 60 * 60;

/**
 * Age past which a `status='processing'` row is treated as wedged and its
 * normalize re-driven. A row sits at `processing` only while a normalize job is
 * queued or running; lingering far past this means the job vanished WITHOUT
 * flipping the row (worker died / pod killed / Redis lost the job after a
 * successful `.send()`) — the *lost-after-send* window no enqueue catch can see.
 *
 * Much shorter than the pending TTL (a normalize finishes in minutes even for a
 * multi-GB file, vs. a pending upload that legitimately lingers), yet a false
 * positive is harmless: the I-IDEM handler guard + concurrency-1 group make a
 * re-drive of a still-running normalize a queued no-op. Poll-triggered via
 * `reapStaleProcessing` (no cron — same as the pending sweep).
 */
export const STALE_PROCESSING_TTL_SECONDS = 60 * 60;

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
