/**
 * Storing a file that a dataset cell points at.
 *
 * The route hands the bytes here; this module applies the upload policy
 * (`~/shared/datasets/attachment-policy`, shared with the browser), writes the
 * file to the project's object store, and returns the reference the cell holds.
 * Reads go back through `GET /api/files/:projectId/:id/:filename`.
 */
import { HandledError } from "@langwatch/handled-error";
import { sanitizeFilenameSegment } from "~/server/stored-objects/media-response";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import {
  DATASET_ATTACHMENT_MAX_BYTES,
  isRefusedAttachmentMediaType,
  normalizeAttachmentMediaType,
  REFUSED_ATTACHMENT_MEDIA_TYPES,
} from "~/shared/datasets/attachment-policy";

/** The stored-object purpose that marks a file as a dataset attachment. */
export const DATASET_ATTACHMENT_PURPOSE = "dataset_attachment";

/** The owner kind every dataset attachment carries. */
const ATTACHMENT_OWNER_KIND = "dataset";

/**
 * The owner id for a file uploaded before its dataset exists: the editor
 * uploads into a cell of a draft, and the row is saved afterwards.
 */
const ATTACHMENT_OWNER_ID_WITHOUT_DATASET = "inline";

/** The name a file takes when its own name has no usable characters. */
const FALLBACK_FILE_NAME = "file";

/**
 * The file is over the ceiling.
 *
 * `fault: "customer"` because picking a smaller file is a real action, and
 * `meta.maxBytes` is what the copy turns into the number the customer reads.
 */
export class DatasetAttachmentTooLargeError extends HandledError {
  declare readonly code: "dataset_attachment_too_large";

  constructor(maxBytes: number) {
    super(
      "dataset_attachment_too_large",
      "Dataset attachment is over the size ceiling",
      {
        meta: { maxBytes },
        httpStatus: 413,
        fault: "customer",
      },
    );
    this.name = "DatasetAttachmentTooLargeError";
  }
}

/**
 * The file is of a type a browser can run.
 *
 * `meta.refused` is our own list of media types, not customer input, and the
 * copy renders it as the kinds of file someone recognises.
 */
export class DatasetAttachmentTypeRefusedError extends HandledError {
  declare readonly code: "dataset_attachment_type_refused";

  constructor(mediaType: string) {
    super(
      "dataset_attachment_type_refused",
      "Dataset attachment media type is not accepted",
      {
        meta: {
          mediaType,
          refused: [...REFUSED_ATTACHMENT_MEDIA_TYPES],
        },
        httpStatus: 415,
        fault: "customer",
      },
    );
    this.name = "DatasetAttachmentTypeRefusedError";
  }
}

/** Refuses a file over {@link DATASET_ATTACHMENT_MAX_BYTES}. */
export function assertDatasetAttachmentWithinLimit(sizeBytes: number): void {
  if (sizeBytes > DATASET_ATTACHMENT_MAX_BYTES) {
    throw new DatasetAttachmentTooLargeError(DATASET_ATTACHMENT_MAX_BYTES);
  }
}

/** Refuses a media type a browser can run. */
export function assertDatasetAttachmentMediaTypeAllowed(
  mediaType: string,
): void {
  if (isRefusedAttachmentMediaType(mediaType)) {
    throw new DatasetAttachmentTypeRefusedError(mediaType);
  }
}

export interface StoredDatasetAttachment {
  /** The value the cell holds, and the address the file is served from. */
  url: string;
  /** The file name in the reference, after the read path's own allowlist. */
  name: string;
  mediaType: string;
  sizeBytes: number;
}

/**
 * Stores one file for a project and returns the reference a cell holds.
 *
 * The object store is content addressed, so uploading the same file twice
 * writes the bytes once and returns the same reference both times.
 */
export async function storeDatasetAttachment({
  projectId,
  datasetId,
  fileName,
  declaredMediaType,
  bytes,
}: {
  projectId: string;
  datasetId?: string;
  fileName: string;
  declaredMediaType: string | undefined;
  bytes: Buffer;
}): Promise<StoredDatasetAttachment> {
  assertDatasetAttachmentWithinLimit(bytes.length);

  const mediaType = normalizeAttachmentMediaType(declaredMediaType);
  assertDatasetAttachmentMediaTypeAllowed(mediaType);

  const storedObjects = createStoredObjectsService({ projectId });
  const stored = await storedObjects.storeFromBytes({
    projectId,
    purpose: DATASET_ATTACHMENT_PURPOSE,
    ownerKind: ATTACHMENT_OWNER_KIND,
    ownerId: datasetId ?? ATTACHMENT_OWNER_ID_WITHOUT_DATASET,
    mediaType,
    bytes,
  });

  // The same allowlist the read path applies to the `Content-Disposition`
  // name, applied here so the reference and the served name are one string.
  const name = sanitizeFilenameSegment(fileName) || FALLBACK_FILE_NAME;

  return {
    url: `/api/files/${projectId}/${stored.id}/${name}`,
    name,
    mediaType,
    sizeBytes: bytes.length,
  };
}
