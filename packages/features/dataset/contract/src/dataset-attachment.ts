import { z } from "zod";

/**
 * A dataset attachment is a file a user uploaded into an `image` or `file`
 * typed cell. The bytes live in the stored-object feature; the cell keeps a
 * reference path to them. This module owns the shape of that reference and of
 * the upload contract, so the browser, the dataset server and the experiment
 * run path agree on one format.
 */

/** Hard cap on the decoded bytes of one attachment. */
export const DATASET_ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Upper bound on the data URL a client may send: base64 expands 3 bytes to 4
 * characters, plus room for the `data:<type>;base64,` prefix.
 */
export const DATASET_ATTACHMENT_MAX_DATA_URL_LENGTH =
  Math.ceil(DATASET_ATTACHMENT_MAX_BYTES / 3) * 4 + 256;

/** The stored-object purpose that marks bytes uploaded into a dataset cell. */
export const DATASET_ATTACHMENT_PURPOSE = "dataset_attachment";

/** The stored-object owner kind for those bytes; the owner id is the project. */
export const DATASET_ATTACHMENT_OWNER_KIND = "dataset_attachment";

const REFERENCE_PREFIX = "/api/files/";
const REFERENCE_PATTERN = /^\/api\/files\/([A-Za-z0-9_-]+)\/([A-Za-z0-9_-]+)$/;
const MARKDOWN_LINK_PATTERN = /^\[([^\]]*)\]\(([^)\s]+)\)$/;

export type DatasetAttachmentReference = {
  projectId: string;
  id: string;
  path: string;
  fileName?: string;
};

/** The reference a cell stores for an uploaded attachment. */
export function datasetAttachmentReferencePath({
  projectId,
  id,
}: {
  projectId: string;
  id: string;
}): string {
  return `${REFERENCE_PREFIX}${projectId}/${id}`;
}

/**
 * Splits a cell value into its link target and optional display name. A cell
 * may hold a bare value or a markdown link `[name](target)`.
 */
export function parseDatasetFileCell(value: unknown): { url: string; fileName?: string } | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const link = MARKDOWN_LINK_PATTERN.exec(trimmed);
  if (link) {
    const [, name, target] = link;
    if (!target) return null;
    return name && name.trim().length > 0
      ? { url: target, fileName: name.trim() }
      : { url: target };
  }

  if (/\s/.test(trimmed)) return null;
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith(REFERENCE_PREFIX)
  ) {
    return { url: trimmed };
  }
  return null;
}

/**
 * Recognises a stored attachment reference in a cell value, bare or inside a
 * markdown link. Anything else (external URLs, data URLs, text) returns null.
 */
export function parseDatasetAttachmentReference(value: unknown): DatasetAttachmentReference | null {
  const cell = parseDatasetFileCell(value);
  if (!cell) return null;
  const match = REFERENCE_PATTERN.exec(cell.url);
  if (!match) return null;
  const [, projectId, id] = match;
  if (!projectId || !id) return null;
  return cell.fileName
    ? { projectId, id, path: cell.url, fileName: cell.fileName }
    : { projectId, id, path: cell.url };
}

/** The value a `file` cell stores after an upload: a markdown link keeps the name. */
export function datasetFileCellValue({
  fileName,
  path,
}: {
  fileName: string;
  path: string;
}): string {
  const safeName = fileName.replace(/[[\]]/g, "").trim();
  return safeName.length > 0 ? `[${safeName}](${path})` : path;
}

export const uploadDatasetAttachmentInputSchema = z.object({
  projectId: z.string().min(1),
  fileName: z.string().min(1).max(255),
  dataUrl: z.string().min(1).max(DATASET_ATTACHMENT_MAX_DATA_URL_LENGTH),
});
export type UploadDatasetAttachmentInput = z.infer<typeof uploadDatasetAttachmentInputSchema>;

export const datasetAttachmentSchema = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  /** The reference path the cell stores, `/api/files/{projectId}/{id}`. */
  url: z.string().min(1),
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
});
export type DatasetAttachment = z.infer<typeof datasetAttachmentSchema>;
