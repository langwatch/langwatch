/** Presigned direct-upload: browser → S3 via presigned PUT, backend
 * finalizes/normalizes. Session-cookie auth on control plane; NO credentials on S3.
 */

import type { DatasetColumns, DatasetConfirmColumns } from "@langwatch/dataset-contract";

/**
 * Sentinel error for "no browser-reachable object storage" (the backend's
 * 409 `DirectUploadUnavailable`). The caller branches on this to fall back to
 * the in-browser-parse + backend multipart upload path, so small/self-hosted
 * installs with no S3 keep working. Kept client-side and distinct from the
 * server's same-named error so the modal can `instanceof`-check it.
 */
export class DirectUploadUnavailableError extends Error {
  constructor(message = "Direct upload is unavailable; use the backend upload path") {
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

/** Presigned PUT failure (network/CORS/non-ok). Caller falls back to backend upload path. */
export class PresignedUploadFailedError extends Error {
  constructor(message = "Failed to upload the file to object storage", cause?: unknown) {
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
  /** Confirmed columns (ADR-032 v19): bulk drawer sends sourceHeader for
   * rename/reorder; legacy drawer sends bare name+type (positional binding).
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

/** Two URL shapes: S3 (cross-origin, no credentials/Content-Type) vs local-FS
 * (same-origin, include session cookie). "/" is the discriminator.
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
      throw error instanceof Error ? error : new Error("Failed to upload the file");
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
      throw new Error(body.message ?? body.error ?? `Upload failed (status ${response.status})`);
    }
    throw new PresignedUploadFailedError(
      `Failed to upload the file to object storage (status ${response.status})`,
    );
  }
}

/** Cleanup stuck uploading row after PUT failure. Throws on non-2xx for
 * observability; TTL sweep is the durable backstop.
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
