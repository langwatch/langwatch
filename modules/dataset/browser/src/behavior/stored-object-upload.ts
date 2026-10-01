/**
 * One file into storage (ADR-158 §4): create the upload, PUT the file to the
 * signed URL it answers, then confirm. The browser learns no backend, holds no
 * token and computes no hash; the file streams from disk as the PUT body.
 */

import { readHandledError } from "@langwatch/error-presentation/read-handled-error";
import type {
  StoredObjectReference,
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadInput,
  StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";

/** The two stored-object procedures an upload calls. */
export type StoredObjectUploadTransport = {
  createUpload: (input: StoredObjectsCreateUploadInput) => Promise<StoredObjectsCreateUploadOutput>;
  confirmUpload: (input: StoredObjectsConfirmUploadInput) => Promise<StoredObjectReference>;
};

/** A cross-origin PUT that never answered: a missing bucket CORS rule or no connectivity. */
export class PresignedUploadFailedError extends Error {
  constructor(message = "Failed to upload the file to object storage", cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PresignedUploadFailedError";
  }
}

const MEDIA_TYPE_FALLBACK = "application/octet-stream";

function isSameOrigin(uploadUrl: string): boolean {
  if (typeof window === "undefined") return uploadUrl.startsWith("/");
  return new URL(uploadUrl, window.location.href).origin === window.location.origin;
}

/**
 * PUT the file to the signed URL with the headers `createUpload` answered. The
 * signature is the credential, so no cookie rides along. The local signed
 * route answers a handled body on refusal, which rides on the thrown error.
 */
export async function putFileToUploadUrl({
  upload,
  file,
  signal,
}: {
  upload: StoredObjectsCreateUploadOutput;
  file: File;
  signal?: AbortSignal;
}): Promise<void> {
  const sameOrigin = isSameOrigin(upload.uploadUrl);
  let response: Response;
  try {
    response = await fetch(upload.uploadUrl, {
      method: upload.method,
      headers: upload.headers,
      body: file,
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    if (sameOrigin) {
      throw error instanceof Error ? error : new Error("Failed to upload the file");
    }
    throw new PresignedUploadFailedError(
      "Failed to upload the file to object storage (network or CORS error)",
      error,
    );
  }

  if (response.ok) return;
  if (!sameOrigin) {
    throw new PresignedUploadFailedError(
      `Failed to upload the file to object storage (status ${response.status})`,
    );
  }
  const body: unknown = await response.json().catch(() => null);
  const error = new Error(`The upload was refused with HTTP ${response.status}`);
  if (!readHandledError(body)) throw error;
  throw Object.assign(error, body, { status: response.status });
}

/** Create, PUT, confirm: the confirmed reference, ready to attach or import. */
export async function uploadStoredObject({
  projectId,
  purpose,
  file,
  signal,
  transport,
}: {
  projectId: string;
  purpose: string;
  file: File;
  signal?: AbortSignal;
  transport: StoredObjectUploadTransport;
}): Promise<StoredObjectReference> {
  const upload = await transport.createUpload({
    projectId,
    purpose,
    filename: file.name,
    mediaType: file.type || MEDIA_TYPE_FALLBACK,
    byteLength: file.size,
  });
  signal?.throwIfAborted();
  await putFileToUploadUrl({ upload, file, signal });
  return transport.confirmUpload({ projectId, objectId: upload.objectId });
}
