/**
 * Browser-side client for the presigned direct-upload flow (ADR-032 D4).
 *
 * One upload path for all sizes: the browser sends the raw file straight to
 * object storage via a presigned PUT, then asks the backend to finalize and
 * normalize it. Mirrors the raw-`fetch` style of `scenarioGeneration.ts`
 * (same-origin, NextAuth session-cookie auth, no auth header; throw on `!ok`).
 *
 * Auth: the three control-plane routes (`/direct-upload`, `/finalize`,
 * `/retry`) authenticate the logged-in user by the NextAuth session cookie
 * (sent automatically on same-origin requests) and read `projectId` from the
 * request to scope the permission check. We do NOT send an Authorization /
 * X-Auth-Token header.
 *
 * The one cross-origin call is the PUT to the storage URL — that one carries
 * NO credentials (S3 rejects cookies on a presigned URL) and NO Content-Type
 * (see `putFileToPresignedUrl`).
 */

import type {
  DatasetColumns,
  DatasetConfirmColumns,
} from "~/server/datasets/types";

/**
 * Sentinel error for "no browser-reachable object storage" (the backend's
 * 409 `DirectUploadUnavailable`). The caller branches on this to fall back to
 * the in-browser-parse + backend multipart upload path, so small/self-hosted
 * installs with no S3 keep working. Kept client-side and distinct from the
 * server's same-named error so the modal can `instanceof`-check it.
 */
export class DirectUploadUnavailableError extends Error {
  constructor(
    message = "Direct upload is unavailable; use the backend upload path",
  ) {
    super(message);
    this.name = "DirectUploadUnavailableError";
  }
}

/** Thrown when a dataset with the proposed name already exists (409 Conflict). */
export class DatasetNameConflictError extends Error {
  constructor(message = "A dataset with this name already exists") {
    super(message);
    this.name = "DatasetNameConflictError";
  }
}

/**
 * Thrown when the presigned PUT to object storage fails — a non-ok response, or
 * a network / CORS failure (a missing bucket CORS rule surfaces as an opaque
 * `fetch` rejection / `TypeError`, never a status code). Distinct from
 * `DirectUploadUnavailableError` (which means the backend never minted a presign
 * at all): both signal the caller to fall back to the backend upload path, so a
 * misconfigured bucket isn't a dead end for small files (the size-guard handles
 * large ones). Carries the underlying cause for diagnostics.
 */
export class PresignedUploadFailedError extends Error {
  constructor(
    message = "Failed to upload the file to object storage",
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PresignedUploadFailedError";
  }
}

export type DirectUploadHandle = {
  datasetId: string;
  slug: string;
  uploadUrl: string;
};

/**
 * Start a direct upload: POST `name` + `filename` as FormData; the backend
 * mints a presigned PUT and an `uploading` dataset row bound to the staging
 * key. On 409 it either has no S3 (fall back) or hit a name clash.
 */
export async function requestDirectUpload({
  projectId,
  name,
  filename,
  columnTypes,
}: {
  projectId: string;
  name: string;
  filename: string;
  /**
   * Confirmed columns from the upload confirm step (ADR-032 v19), sent as JSON
   * so the normalize job binds each file header to its column and renames +
   * type-converts each record to match. The bulk drawer sends the richer shape
   * (each column carries an immutable `sourceHeader`) so the confirm UI can
   * rename + drag-reorder without breaking the binding; the legacy single-file
   * drawer locks column order and sends the bare name+type shape (normalize then
   * binds positionally). Omitted when the header couldn't be parsed (then
   * normalize derives all-`string`).
   */
  columnTypes?: DatasetConfirmColumns | DatasetColumns;
}): Promise<DirectUploadHandle> {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("name", name);
  form.append("filename", filename);
  if (columnTypes && columnTypes.length > 0) {
    form.append("columnTypes", JSON.stringify(columnTypes));
  }

  const response = await fetch("/api/dataset/direct-upload", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 409 && body.error === "DirectUploadUnavailable") {
      throw new DirectUploadUnavailableError(body.message);
    }
    if (response.status === 409 && body.error === "Conflict") {
      throw new DatasetNameConflictError(body.message);
    }
    throw new Error(body.error || body.message || "Failed to start upload");
  }

  return (await response.json()) as DirectUploadHandle;
}

/**
 * PUT the raw file to the upload URL. Two URL shapes, two credential modes:
 *
 *  - Absolute (cross-origin S3): NO credentials — a presigned request must not
 *    carry our session cookie — and NO Content-Type: `createPresignedUpload`
 *    signs the `PutObjectCommand` WITHOUT a `ContentType`, so the signature
 *    doesn't cover a `Content-Type` header; setting one adds an unsigned header
 *    some S3 impls fold into the canonical request, breaking the signature.
 *  - Relative `/...` (same-origin): the no-S3 local-FS path — the file streams
 *    through our own API to local-FS staging, so we DO send the session cookie
 *    (`credentials: "include"`); the route is session-authed and there is no
 *    signature to keep intact.
 *
 * A leading "/" is the discriminator: relative ⇒ same-origin local route.
 */
export async function putFileToPresignedUrl(
  uploadUrl: string,
  file: File,
  signal?: AbortSignal,
): Promise<void> {
  const sameOrigin = uploadUrl.startsWith("/");
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      credentials: sameOrigin ? "include" : "omit",
      signal,
    });
  } catch (error) {
    // A user-initiated cancel aborts the fetch: propagate the AbortError as-is
    // so the caller treats it as a cancel, not a CORS/network fallback signal.
    if (error instanceof Error && error.name === "AbortError") {
      throw error;
    }
    // Same-origin (local-FS streaming route): a fetch rejection is a genuine
    // server/network failure, NOT a CORS-fallback signal — surface it directly
    // (falling back to in-browser parse can't help; the local route IS the
    // upload mechanism). Cross-origin (S3): an opaque TypeError means a missing
    // bucket CORS rule (no status to read) — wrap it so the modal falls back.
    if (sameOrigin) {
      throw error instanceof Error
        ? error
        : new Error("Failed to upload the file");
    }
    throw new PresignedUploadFailedError(
      "Failed to upload the file to object storage (network or CORS error)",
      error,
    );
  }

  if (!response.ok) {
    // Same-origin failure is the local route reporting a real, actionable reason
    // (unwritable LANGWATCH_LOCAL_STORAGE_PATH, size cap, no pending row). Surface
    // that message rather than fall back to the in-browser parse — which would
    // show the misleading "requires object storage" cap error for a deployment
    // that HAS storage, just misconfigured.
    if (sameOrigin) {
      const body = (await response.json().catch(() => ({}))) as {
        message?: string;
        error?: string;
      };
      throw new Error(
        body.message ??
          body.error ??
          `Upload failed (status ${response.status})`,
      );
    }
    throw new PresignedUploadFailedError(
      `Failed to upload the file to object storage (status ${response.status})`,
    );
  }
}

/**
 * Best-effort cleanup of the just-created pending (`uploading`) dataset after a
 * presigned-PUT failure, so a CORS-failed attempt doesn't leave a stuck
 * `uploading` row behind. Authenticated by the same session cookie the other
 * direct-upload routes use.
 *
 * A non-2xx DELETE (DB timeout, pod restart) THROWS rather than resolving
 * silently: every caller already wraps this in a `.catch`/try-catch that logs,
 * so the failure becomes observable (an orphaned `uploading` row pins its slug
 * and counts against project quota until reaped). Callers still proceed with the
 * fallback regardless — the reject is for visibility, not control flow. A
 * server-side TTL sweep of stale `uploading` rows is the durable backstop.
 */
export async function abortPendingUpload({
  projectId,
  datasetId,
}: {
  projectId: string;
  datasetId: string;
}): Promise<void> {
  const response = await fetch(
    `/api/dataset/direct-upload/${datasetId}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    throw new Error(
      `abortPendingUpload: DELETE failed (status ${response.status}) — dataset ${datasetId} may remain in 'uploading'`,
    );
  }
}

/**
 * Finalize a direct upload: size-check the staged object and flip the dataset
 * to `processing` so the normalize job runs.
 */
export async function finalizeDirectUpload({
  projectId,
  datasetId,
}: {
  projectId: string;
  datasetId: string;
}): Promise<{ datasetId: string; status: string }> {
  const response = await fetch(
    `/api/dataset/direct-upload/${datasetId}/finalize?projectId=${encodeURIComponent(projectId)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || "Failed to finalize upload");
  }

  return (await response.json()) as { datasetId: string; status: string };
}

/**
 * Retry normalization of a failed or stuck dataset (I-RECOVER). Flips the
 * dataset back to `processing` so the poll resumes.
 */
export async function retryDatasetNormalize({
  projectId,
  datasetId,
}: {
  projectId: string;
  datasetId: string;
}): Promise<{ datasetId: string; status: string }> {
  const response = await fetch(
    `/api/dataset/direct-upload/${datasetId}/retry?projectId=${encodeURIComponent(projectId)}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || body.message || "Failed to retry processing");
  }

  return (await response.json()) as { datasetId: string; status: string };
}
