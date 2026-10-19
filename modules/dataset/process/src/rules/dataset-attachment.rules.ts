/**
 * The upload policy a dataset attachment is held to.
 * @see specs/datasets/dataset-attachments.feature
 */
import {
  DatasetAttachmentTooLargeError,
  DatasetAttachmentTypeRefusedError,
  isRefusedAttachmentMediaType,
} from "@langwatch/dataset-contract";

/** Refuses a file over the per-file limit the organization answers. */
export function assertDatasetAttachmentWithinLimit(sizeBytes: number, maxBytes: number): void {
  if (sizeBytes > maxBytes) {
    throw new DatasetAttachmentTooLargeError(maxBytes);
  }
}

/** Refuses a media type a browser can run. */
export function assertDatasetAttachmentMediaTypeAllowed(mediaType: string): void {
  if (isRefusedAttachmentMediaType(mediaType)) {
    throw new DatasetAttachmentTypeRefusedError(mediaType);
  }
}
