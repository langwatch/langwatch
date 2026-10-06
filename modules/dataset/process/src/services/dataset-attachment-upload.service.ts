/**
 * A file stored as a dataset attachment: posted to the deprecated
 * `/attachments` route, sent to a signed upload, or found inline in a row.
 * Each is held to the per-file limit the project's organization answers.
 */
import { sanitizeFilenameSegment } from "@langwatch/api/rest";
import {
  normalizeAttachmentMediaType,
  type CreateDatasetAttachmentUploadInput,
  type StoreDatasetAttachmentUploadInput,
  type StoredDatasetAttachment,
} from "@langwatch/dataset-contract";
import {
  DATASET_ATTACHMENT_PURPOSE,
  type StoredObjectApi,
  type StoredObjectByteSource,
  type StoredObjectsCreateUploadOutput,
} from "@langwatch/stored-object-contract";

import {
  assertDatasetAttachmentMediaTypeAllowed,
  assertDatasetAttachmentWithinLimit,
} from "../rules/dataset-attachment.rules.ts";
import type { DatasetRequestBoundsService } from "./dataset-request-bounds.service.ts";

const ATTACHMENT_OWNER_KIND = "dataset";

/** The owner id for a file uploaded into a draft, before its dataset exists. */
const ATTACHMENT_OWNER_ID_WITHOUT_DATASET = "inline";

const FALLBACK_FILE_NAME = "file";

export class DatasetAttachmentUploadService {
  static create(deps: {
    storedObjects: StoredObjectApi;
    requestBounds: Pick<DatasetRequestBoundsService, "limit">;
  }): DatasetAttachmentUploadService {
    return new DatasetAttachmentUploadService(deps.storedObjects, deps.requestBounds);
  }

  readonly #storedObjects: StoredObjectApi;

  readonly #requestBounds: Pick<DatasetRequestBoundsService, "limit">;

  private constructor(
    storedObjects: StoredObjectApi,
    requestBounds: Pick<DatasetRequestBoundsService, "limit">,
  ) {
    this.#storedObjects = storedObjects;
    this.#requestBounds = requestBounds;
  }

  /** The per-file limit the project's organization answers. */
  maxBytes(projectId: string): Promise<number> {
    return this.#requestBounds.limit(projectId, "attachmentBytes");
  }

  async store(input: StoreDatasetAttachmentUploadInput): Promise<StoredDatasetAttachment> {
    return this.storeBytes({
      projectId: input.projectId,
      datasetId: input.datasetId,
      filename: input.filename,
      mediaType: input.mediaType,
      bytes: input.bytes,
      byteLength: input.fileSize,
      maxBytes: await this.maxBytes(input.projectId),
    });
  }

  /** Bytes already in hand, held to a limit the caller resolved once for many files. */
  async storeBytes(input: {
    projectId: string;
    datasetId?: string;
    filename: string;
    mediaType: string | undefined;
    bytes: StoredObjectByteSource;
    byteLength: number;
    maxBytes: number;
  }): Promise<StoredDatasetAttachment> {
    assertDatasetAttachmentWithinLimit(input.byteLength, input.maxBytes);
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
      maxBytes: input.maxBytes,
    });

    return {
      url: `/api/files/${input.projectId}/${reference.id}/${name}`,
      name,
      mediaType,
      sizeBytes: reference.byteLength,
    };
  }

  /**
   * The signed upload for a file a cell is about to hold. A file over the
   * organization's limit is refused here, before any byte is accepted.
   */
  async createUpload(
    input: CreateDatasetAttachmentUploadInput,
  ): Promise<StoredObjectsCreateUploadOutput> {
    const maxBytes = await this.maxBytes(input.projectId);
    assertDatasetAttachmentWithinLimit(input.byteLength, maxBytes);
    assertDatasetAttachmentMediaTypeAllowed(normalizeAttachmentMediaType(input.mediaType));

    return this.#storedObjects.createUpload({
      projectId: input.projectId,
      purpose: DATASET_ATTACHMENT_PURPOSE,
      filename: input.filename,
      mediaType: input.mediaType,
      byteLength: input.byteLength,
      maxBytes,
    });
  }
}
