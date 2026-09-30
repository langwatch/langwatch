/**
 * Browser-side client for dataset cell attachments.
 *
 * The file goes straight to `POST /api/dataset/attachments` as multipart form
 * data. The route reads the logged-in user from the session cookie, so the
 * request carries credentials and no authorization header; the project rides
 * in the query string, which is how the other dataset upload routes scope
 * their permission check.
 *
 * A rejection answers with the flat handled body
 * (`{ error: "<code>", message, ...meta }`, see
 * `src/app/api/middleware/error-handler.ts`). That body rides ON the thrown
 * `Error` so `readHandledError` finds it and the cell renders the copy the
 * registry holds for the code. See
 * `dev/docs/best_practices/error-handling.md`.
 */

import { readHandledError } from "~/features/errors";
import { DATASET_ATTACHMENT_MAX_BYTES } from "~/shared/datasets/attachment-policy";

/** What the route answers with for a stored file. */
export type DatasetAttachment = {
  /** `/api/files/{projectId}/{objectId}/{name}`, the value of the cell. */
  url: string;
  name: string;
  mediaType: string;
  sizeBytes: number;
};

export async function uploadDatasetAttachment({
  projectId,
  datasetId,
  file,
  signal,
}: {
  projectId: string;
  /** The dataset that owns the file, when the grid edits a saved dataset. */
  datasetId?: string;
  file: File;
  signal?: AbortSignal;
}): Promise<DatasetAttachment> {
  if (file.size > DATASET_ATTACHMENT_MAX_BYTES) {
    throw tooLargeError(file.size);
  }

  const form = new FormData();
  form.append("file", file);
  if (datasetId) {
    form.append("datasetId", datasetId);
  }

  const response = await fetch(
    `/api/dataset/attachments?projectId=${encodeURIComponent(projectId)}`,
    {
      method: "POST",
      body: form,
      credentials: "include",
      signal,
    },
  );

  if (!response.ok) {
    throw await refusalError(response);
  }

  const body: unknown = await response.json();
  const attachment = readAttachment(body);
  if (!attachment) {
    throw new Error("The upload answered with an unreadable result");
  }
  return attachment;
}

/**
 * The size check the browser makes before it sends anything. The route makes
 * the same check, so this only saves the customer a long upload that ends in a
 * refusal; the code and the meta match what the route answers with, so the
 * cell renders the same words either way.
 */
function tooLargeError(sizeBytes: number): Error {
  return Object.assign(new Error("The file is larger than the size limit"), {
    error: "dataset_attachment_too_large",
    maxBytes: DATASET_ATTACHMENT_MAX_BYTES,
    sizeBytes,
    status: 413,
  });
}

async function refusalError(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => null);
  const error = new Error(
    `The attachment upload was refused with HTTP ${response.status}`,
  );

  // A body with no code we can read stays unhandled: an unhandled failure, or
  // a proxy that answered before the route ran. That is the generic "unknown"
  // path and it is correct (ADR-045).
  if (!readHandledError(body)) return error;

  return Object.assign(error, body as Record<string, unknown>, {
    status: response.status,
  });
}

function readAttachment(body: unknown): DatasetAttachment | null {
  if (typeof body !== "object" || body === null) return null;
  const candidate = body as Record<string, unknown>;
  if (typeof candidate.url !== "string" || candidate.url.length === 0) {
    return null;
  }

  return {
    url: candidate.url,
    name: typeof candidate.name === "string" ? candidate.name : "",
    mediaType:
      typeof candidate.mediaType === "string" ? candidate.mediaType : "",
    sizeBytes:
      typeof candidate.sizeBytes === "number" ? candidate.sizeBytes : 0,
  };
}
