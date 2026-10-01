/**
 * The upload policy a dataset attachment is held to.
 * @see specs/datasets/dataset-attachments.feature
 */
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentTypeRefusedError,
  isRefusedAttachmentMediaType,
} from "@langwatch/dataset-contract";

/** Refuses a file over the attachment size cap. */
export function assertDatasetAttachmentWithinLimit(sizeBytes: number): void {
  if (sizeBytes > DATASET_ATTACHMENT_MAX_BYTES) {
    throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
  }
}

/** Refuses a media type a browser can run. */
export function assertDatasetAttachmentMediaTypeAllowed(mediaType: string): void {
  if (isRefusedAttachmentMediaType(mediaType)) {
    throw new DatasetAttachmentTypeRefusedError(mediaType);
  }
}
