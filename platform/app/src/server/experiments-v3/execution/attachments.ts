/**
 * Attachments a row carries into the target it runs.
 *
 * An image or file cell holds a reference, never the bytes. A file uploaded
 * to LangWatch is `/api/files/{projectId}/{objectId}/{name}`, which nothing
 * outside the platform can read: the address is relative, the route is behind
 * the session, and a service that dials it is refused. So the run reads the
 * object here and sends a base64 data URL instead.
 *
 * An address on the public internet is left alone for a prompt, because the
 * model service reads it itself and writes its own error copy for a bad one.
 * An agent runs outside the platform, so the run reads that address too and
 * sends the bytes.
 *
 * Only a column the person typed as image or file is ever read. A text column
 * that happens to hold a link stays the sentence it is.
 *
 * @see specs/experiments-v3/attachment-inputs.feature
 */

import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import {
  DATASET_ATTACHMENT_PURPOSE,
  DatasetAttachmentTooLargeError,
} from "~/server/datasets/attachments";
import { createStoredObjectsService } from "~/server/stored-objects/stored-objects-factory";
import {
  attachmentDisplayName,
  parseDatasetAttachmentRef,
} from "~/shared/datasets/attachment-ref";
import { ssrfSafeFetch } from "~/utils/ssrfProtection";
import type { AttachmentBytes } from "./attachmentParts";
import { attachmentDataUrl } from "./attachmentParts";

const logger = createLogger("experiments-v3:attachments");

/**
 * The largest attachment a row sends.
 *
 * The same cap the upload route and the engine apply, so a file that was
 * accepted on the way in is never refused on the way out.
 */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

/** How long the run waits for an address on the public internet. */
export const EXTERNAL_ATTACHMENT_TIMEOUT_MS = 30_000;

/** The column types whose values are addresses of bytes, not text. */
const ATTACHMENT_COLUMN_TYPES = new Set(["image", "file"]);

/** Reads one stored object of this project, or nothing when it is gone. */
export type StoredAttachmentReader = (args: {
  projectId: string;
  objectId: string;
}) => Promise<AttachmentBytes | null>;

/** Reads one address on the public internet. */
export type ExternalAttachmentReader = (args: {
  url: string;
  /** The dataset column type the value comes from, when the run knows it. */
  columnType?: string;
}) => Promise<AttachmentBytes>;

/**
 * An attachment the row names but the run cannot read.
 *
 * Coded rather than left unnamed because the cause is known and the person
 * can act on it: the object the cell points at is gone, so the file has to be
 * uploaded again. Without a code every such row read as the generic unknown
 * failure, which says nothing about which file of which column is missing.
 */
export class DatasetAttachmentUnavailableError extends HandledError {
  declare readonly code: "dataset_attachment_unavailable";

  constructor(fileName: string) {
    super(
      "dataset_attachment_unavailable",
      `The attachment "${fileName}" could not be read.`,
      {
        httpStatus: 400,
        fault: "customer",
        // Named consumer: the results cell, which draws the file name so the
        // reader knows which cell of the row to upload again.
        meta: { fileName },
      },
    );
    this.name = "DatasetAttachmentUnavailableError";
  }
}

/** Reads a stream up to the cap, and refuses anything past it. */
const readStreamCapped = async ({
  stream,
}: {
  stream: Readable;
}): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_ATTACHMENT_BYTES) {
      stream.destroy();
      throw new DatasetAttachmentTooLargeError(MAX_ATTACHMENT_BYTES);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

/**
 * The production reader of a LangWatch attachment.
 *
 * Only an object stored as a dataset attachment is read. The object store
 * holds trace media and scenario media too, and each of those asks for its own
 * permission on the read route. A cell that names one of them therefore reads
 * as gone here, so a run can never carry bytes the person could not open.
 */
export const storedAttachmentReader: StoredAttachmentReader = async ({
  projectId,
  objectId,
}) => {
  const service = createStoredObjectsService({ projectId });
  const found = await service.getById({ projectId, id: objectId });
  if (!found || "status" in found) return null;
  if (found.row.purpose !== DATASET_ATTACHMENT_PURPOSE) {
    found.stream.destroy?.();
    logger.warn(
      { projectId, objectId, purpose: found.row.purpose },
      "Dataset attachment reference names an object of another purpose",
    );
    return null;
  }
  const bytes = await readStreamCapped({ stream: found.stream });
  return { mediaType: found.row.media_type, bytes };
};

/**
 * The production reader of an address on the public internet.
 *
 * The address belongs to whoever wrote the cell, so the answer is never
 * trusted: a declared length over the ceiling is refused before a byte is
 * read, the body is read as a stream and cut at the same ceiling, and an image
 * column only accepts a picture.
 */
export const externalAttachmentReader: ExternalAttachmentReader = async ({
  url,
  columnType,
}) => {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    EXTERNAL_ATTACHMENT_TIMEOUT_MS,
  );
  try {
    const response = await ssrfSafeFetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new DatasetAttachmentUnavailableError(attachmentDisplayName(url));
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (
      Number.isFinite(declaredLength) &&
      declaredLength > MAX_ATTACHMENT_BYTES
    ) {
      throw new DatasetAttachmentTooLargeError(MAX_ATTACHMENT_BYTES);
    }

    const mediaType =
      response.headers.get("content-type")?.split(";")[0]?.trim() ??
      "application/octet-stream";
    if (columnType === "image" && !mediaType.startsWith("image/")) {
      logger.warn(
        { url, mediaType },
        "Image column address answered with something other than a picture",
      );
      throw new DatasetAttachmentUnavailableError(attachmentDisplayName(url));
    }

    if (!response.body) {
      throw new DatasetAttachmentUnavailableError(attachmentDisplayName(url));
    }
    const bytes = await readStreamCapped({
      stream: Readable.fromWeb(response.body as WebReadableStream),
    });

    return {
      mediaType,
      bytes,
      name: attachmentDisplayName(url),
    };
  } finally {
    clearTimeout(timeout);
  }
};

/** Whether the value is an address the run may read. */
const isExternalUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/**
 * The inputs of one row, with every attachment read into the row.
 *
 * A value that is not an attachment is not copied: the record that comes back
 * holds the same reference, so a row with no attachment costs one object.
 */
export const resolveAttachmentInputs = async ({
  projectId,
  inputs,
  columnTypeOfInput,
  fetchExternal,
  readStoredAttachment = storedAttachmentReader,
  readExternalAttachment = externalAttachmentReader,
}: {
  projectId: string;
  inputs: Record<string, unknown>;
  /** The dataset column type the input field is mapped from. */
  columnTypeOfInput: (inputField: string) => string | undefined;
  /** Whether an address on the public internet is read here too. */
  fetchExternal: boolean;
  readStoredAttachment?: StoredAttachmentReader;
  readExternalAttachment?: ExternalAttachmentReader;
}): Promise<Record<string, unknown>> => {
  const resolved: Record<string, unknown> = { ...inputs };
  let changed = false;

  for (const [field, value] of Object.entries(inputs)) {
    if (typeof value !== "string" || value === "") continue;

    const ref = parseDatasetAttachmentRef(value);
    if (ref) {
      resolved[field] = await readStoredAttachmentInput({
        projectId,
        ref,
        value,
        readStoredAttachment,
      });
      changed = true;
      continue;
    }

    const columnType = columnTypeOfInput(field);
    if (
      !fetchExternal ||
      !columnType ||
      !ATTACHMENT_COLUMN_TYPES.has(columnType) ||
      !isExternalUrl(value)
    ) {
      continue;
    }

    resolved[field] = attachmentDataUrl(
      await readExternalAttachment({ url: value, columnType }),
    );
    changed = true;
  }

  return changed ? resolved : inputs;
};

/** One LangWatch attachment, as the data URL the target receives. */
const readStoredAttachmentInput = async ({
  projectId,
  ref,
  value,
  readStoredAttachment,
}: {
  projectId: string;
  ref: { projectId: string; objectId: string; name?: string };
  value: string;
  readStoredAttachment: StoredAttachmentReader;
}): Promise<string> => {
  const fileName = ref.name ?? attachmentDisplayName(value);

  // A reference names the project it belongs to. A run reads only its own
  // project's objects, so a reference to another project is unavailable here
  // rather than a read across tenants.
  if (ref.projectId !== projectId) {
    logger.warn(
      { projectId, refProjectId: ref.projectId },
      "Dataset attachment names another project",
    );
    throw new DatasetAttachmentUnavailableError(fileName);
  }

  const found = await readStoredAttachment({
    projectId,
    objectId: ref.objectId,
  });
  if (!found) {
    logger.warn(
      { projectId, objectId: ref.objectId },
      "Dataset attachment no longer resolves",
    );
    throw new DatasetAttachmentUnavailableError(fileName);
  }

  return attachmentDataUrl({ ...found, name: found.name ?? fileName });
};
