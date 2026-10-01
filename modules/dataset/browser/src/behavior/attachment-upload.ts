/**
 * A dataset cell's file, uploaded by reference (ADR-158 §6): the file goes to
 * storage under the `dataset_attachment` purpose and the cell holds the
 * `/api/files/...` reference the dataset checks when the record is saved.
 */

import { DATASET_ATTACHMENT_MAX_BYTES, datasetAttachmentRefOf } from "@langwatch/dataset-contract";
import { DATASET_ATTACHMENT_PURPOSE } from "@langwatch/stored-object-contract";

import { type StoredObjectUploadTransport, uploadStoredObject } from "./stored-object-upload.ts";

export async function uploadDatasetAttachment({
  projectId,
  file,
  signal,
  transport,
}: {
  projectId: string;
  file: File;
  signal?: AbortSignal;
  transport: StoredObjectUploadTransport;
}): Promise<string> {
  if (file.size > DATASET_ATTACHMENT_MAX_BYTES) {
    throw tooLargeError(file.size);
  }
  const reference = await uploadStoredObject({
    projectId,
    purpose: DATASET_ATTACHMENT_PURPOSE,
    file,
    signal,
    transport,
  });
  return datasetAttachmentRefOf(reference);
}

/**
 * The browser's own size check, so an oversized file never starts a long
 * upload. Same code and meta the save answers with, so the cell reads the same.
 */
function tooLargeError(sizeBytes: number): Error {
  return Object.assign(new Error("The file is larger than the size limit"), {
    error: "dataset_attachment_too_large",
    maxBytes: DATASET_ATTACHMENT_MAX_BYTES,
    sizeBytes,
    status: 413,
  });
}
