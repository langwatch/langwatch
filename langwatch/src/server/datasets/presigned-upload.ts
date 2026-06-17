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

/** True when a staged object exceeds the hard cap (checked at finalize). */
export const exceedsUploadCap = (
  sizeBytes: number,
  maxBytes: number = UPLOAD_MAX_BYTES,
): boolean => sizeBytes > maxBytes;
