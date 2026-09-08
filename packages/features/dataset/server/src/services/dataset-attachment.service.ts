/**
 * Files a person uploads into a dataset cell.
 *
 * The browser reads the file it picked into a base64 data URL and sends it
 * here. This service decides whether the body is readable, whether it fits,
 * what media type to keep it under and what name the cell shows, then hands
 * the bytes to the project's object store and answers with the reference the
 * cell writes.
 *
 * Spec: packages/features/dataset/specs/dataset-attachments.feature.
 */
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DATASET_ATTACHMENT_OWNER_KIND,
  DATASET_ATTACHMENT_PURPOSE,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentUnreadableError,
  datasetAttachmentReferencePath,
  type DatasetAttachment,
  type UploadDatasetAttachmentInput,
} from "@langwatch/dataset-contract";

import type { DatasetAttachmentStorePort } from "../ports/dataset-attachment-store.port.ts";
import {
  decodedByteLength,
  parseDataUrl,
  resolveAttachmentMediaType,
  sanitizeAttachmentFileName,
} from "../rules/dataset-attachment.rules.ts";

export class DatasetAttachmentService {
  static create(options: { store: DatasetAttachmentStorePort }): DatasetAttachmentService {
    return new DatasetAttachmentService(options.store);
  }

  private constructor(private readonly store: DatasetAttachmentStorePort) {}

  /**
   * Keeps one uploaded file and answers with what the cell needs to point at
   * it. The size is read off the base64 length first, so a body far over the
   * limit is refused without decoding it into the heap.
   */
  async upload({
    projectId,
    fileName,
    dataUrl,
  }: UploadDatasetAttachmentInput): Promise<DatasetAttachment> {
    const parsed = parseDataUrl(dataUrl);
    if (!parsed) throw new DatasetAttachmentUnreadableError();

    if (decodedByteLength(parsed.base64) > DATASET_ATTACHMENT_MAX_BYTES) {
      throw new DatasetAttachmentTooLargeError();
    }

    const safeFileName = sanitizeAttachmentFileName(fileName);
    const mediaType = resolveAttachmentMediaType({
      ...(parsed.mediaType !== undefined ? { declared: parsed.mediaType } : {}),
      fileName: safeFileName,
    });

    const bytes = Buffer.from(parsed.base64, "base64");
    if (bytes.length === 0) throw new DatasetAttachmentUnreadableError();
    if (bytes.length > DATASET_ATTACHMENT_MAX_BYTES) throw new DatasetAttachmentTooLargeError();

    const stored = await this.store.storeFromBytes({
      projectId,
      purpose: DATASET_ATTACHMENT_PURPOSE,
      ownerKind: DATASET_ATTACHMENT_OWNER_KIND,
      // A cell may move between datasets and a dataset may be deleted while
      // the file is still referenced from a copy of the row, so the project is
      // what owns the bytes rather than one dataset.
      ownerId: projectId,
      mediaType,
      bytes,
    });

    return {
      id: stored.id,
      projectId,
      url: datasetAttachmentReferencePath({ projectId, id: stored.id }),
      fileName: safeFileName,
      mediaType: stored.mediaType,
      sizeBytes: bytes.length,
    };
  }
}
