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
 * PUT the raw file to the presigned storage URL.
 *
 * No credentials: the URL is cross-origin (S3-compatible storage) and a
 * presigned request must not carry our session cookie.
 *
 * No Content-Type: `createPresignedUpload` in `s3-dataset-storage.ts` signs a
 * `PutObjectCommand` WITHOUT a `ContentType`, so the signature does not cover a
 * `Content-Type` header. Setting one here would add an unsigned header that
 * some S3 implementations fold into the canonical request, breaking the
 * signature. We deliberately let the browser send the file body with no
 * explicit Content-Type to keep the signed request intact.
 */
export async function putFileToPresignedUrl(
  uploadUrl: string,
  file: File,
): Promise<void> {
  const response = await fetch(uploadUrl, {
    method: "PUT",
    body: file,
    credentials: "omit",
  });

  if (!response.ok) {
    throw new Error(`Failed to upload file (status ${response.status})`);
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
