/** A file posted to the deprecated `/attachments` route, stored as an attachment (ADR-158 §8). */
import { sanitizeFilenameSegment } from "@langwatch/api/rest";
import {
  normalizeAttachmentMediaType,
  type StoreDatasetAttachmentUploadInput,
  type StoredDatasetAttachment,
} from "@langwatch/dataset-contract";
import {
  DATASET_ATTACHMENT_PURPOSE,
  type StoredObjectApi,
} from "@langwatch/stored-object-contract";

import {
  assertDatasetAttachmentMediaTypeAllowed,
  assertDatasetAttachmentWithinLimit,
} from "../rules/dataset-attachment.rules.ts";

const ATTACHMENT_OWNER_KIND = "dataset";

/** The owner id for a file uploaded into a draft, before its dataset exists. */
const ATTACHMENT_OWNER_ID_WITHOUT_DATASET = "inline";

const FALLBACK_FILE_NAME = "file";

export class DatasetAttachmentUploadService {
  static create(deps: { storedObjects: StoredObjectApi }): DatasetAttachmentUploadService {
    return new DatasetAttachmentUploadService(deps.storedObjects);
  }

  readonly #storedObjects: StoredObjectApi;

  private constructor(storedObjects: StoredObjectApi) {
    this.#storedObjects = storedObjects;
  }

  async store(input: StoreDatasetAttachmentUploadInput): Promise<StoredDatasetAttachment> {
    assertDatasetAttachmentWithinLimit(input.fileSize);
    const mediaType = normalizeAttachmentMediaType(input.mediaType);
    assertDatasetAttachmentMediaTypeAllowed(mediaType);

    // The read path's own allowlist, so the reference and the served name are one string.
    const name = sanitizeFilenameSegment(input.filename) || FALLBACK_FILE_NAME;
    const { reference } = await this.#storedObjects.storeFromBytes({
      projectId: input.projectId,
      filename: name,
      mediaType,
      audience: "datasets:view",
      purpose: DATASET_ATTACHMENT_PURPOSE,
      ownerKind: ATTACHMENT_OWNER_KIND,
      ownerId: input.datasetId?.trim() || ATTACHMENT_OWNER_ID_WITHOUT_DATASET,
      bytes: input.bytes,
    });

    return {
      url: `/api/files/${input.projectId}/${reference.id}/${name}`,
      name,
      mediaType,
      sizeBytes: reference.byteLength,
    };
  }
}
