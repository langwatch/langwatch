/**
 * A dataset cell's file, uploaded by reference (ADR-158 §6): the dataset
 * answers a signed upload within the organization's per-file limit, and the
 * cell holds the `/api/files/...` reference checked when the record is saved.
 */

import {
  DATASET_ATTACHMENT_MAX_BYTES,
  datasetAttachmentRefOf,
  type CreateDatasetAttachmentUploadInput,
} from "@langwatch/dataset-contract";
import type {
  StoredObjectReference,
  StoredObjectsConfirmUploadInput,
  StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";

import { putFileToUploadUrl } from "./stored-object-upload.ts";

/** The two procedures an attachment upload calls: the dataset's create, and the confirm. */
export type DatasetAttachmentUploadTransport = {
  createUpload: (
    input: CreateDatasetAttachmentUploadInput,
  ) => Promise<StoredObjectsCreateUploadOutput>;
  confirmUpload: (input: StoredObjectsConfirmUploadInput) => Promise<StoredObjectReference>;
};

const MEDIA_TYPE_FALLBACK = "application/octet-stream";

export async function uploadDatasetAttachment({
  projectId,
  file,
  signal,
  transport,
  maxBytes = DATASET_ATTACHMENT_MAX_BYTES,
}: {
  projectId: string;
  file: File;
  signal?: AbortSignal;
  transport: DatasetAttachmentUploadTransport;
  /** The per-file limit the project's organization answers. */
  maxBytes?: number;
}): Promise<string> {
  if (file.size > maxBytes) {
    throw tooLargeError(file.size, maxBytes);
  }
  const upload = await transport.createUpload({
    projectId,
    filename: file.name,
    mediaType: file.type || MEDIA_TYPE_FALLBACK,
    byteLength: file.size,
  });
  signal?.throwIfAborted();
  await putFileToUploadUrl({ upload, file, signal });
  const reference = await transport.confirmUpload({ projectId, objectId: upload.objectId });

  return datasetAttachmentRefOf(reference);
}

/**
 * The browser's own size check, so an oversized file never starts a long
 * upload. Same code and meta the save answers with, so the cell reads the same.
 */
function tooLargeError(sizeBytes: number, maxBytes: number): Error {
  return Object.assign(new Error("The file is larger than the size limit"), {
    error: "dataset_attachment_too_large",
    maxBytes,
    sizeBytes,
    status: 413,
  });
}
