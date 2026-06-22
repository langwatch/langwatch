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
  stagingKey: string;
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
}: {
  projectId: string;
  name: string;
  filename: string;
}): Promise<DirectUploadHandle> {
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("name", name);
  form.append("filename", filename);

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
): Promise<void> {
  const sameOrigin = uploadUrl.startsWith("/");
  let response: Response;
  try {
    response = await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      credentials: sameOrigin ? "include" : "omit",
    });
  } catch (error) {
    // A cross-origin PUT to a bucket with no CORS rule (or any network failure)
    // rejects `fetch` with an opaque `TypeError` — there is no status to read.
    // Wrap it so the modal can recognize it and fall back to the backend path
    // instead of dead-ending on a generic error.
    throw new PresignedUploadFailedError(
      "Failed to upload the file to object storage (network or CORS error)",
      error,
    );
  }

  if (!response.ok) {
    throw new PresignedUploadFailedError(
      `Failed to upload the file to object storage (status ${response.status})`,
    );
  }
}

/**
 * Best-effort cleanup of the just-created pending (`uploading`) dataset after a
 * presigned-PUT failure, so a CORS-failed attempt doesn't leave a stuck
 * `uploading` row behind. Authenticated by the same session cookie the other
 * direct-upload routes use; failures are swallowed (the fallback path creates a
 * fresh dataset regardless).
 */
export async function abortPendingUpload({
  projectId,
  datasetId,
}: {
  projectId: string;
  datasetId: string;
}): Promise<void> {
  await fetch(
    `/api/dataset/direct-upload/${datasetId}?projectId=${encodeURIComponent(projectId)}`,
    { method: "DELETE" },
  );
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
