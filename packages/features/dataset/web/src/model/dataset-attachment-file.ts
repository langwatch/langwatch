/**
 * Turning a file the reader picked into what the upload procedure takes, and
 * turning what it answers back into the value a cell keeps.
 *
 * The size check runs here rather than only on the server so the reader is told
 * before a 27 MB body is put on the wire. It raises the same code the server
 * raises for the same reason, so the words come from one registry entry either
 * way.
 */

import {
  DATASET_ATTACHMENT_MAX_BYTES,
  DatasetAttachmentTooLargeError,
  DatasetAttachmentUnreadableError,
  datasetFileCellValue,
  parseDatasetAttachmentReference,
  parseDatasetFileCell,
  type DatasetAttachment,
  type DatasetColumnType,
  type UploadDatasetAttachmentInput,
} from "@langwatch/dataset-contract";

/** The column types whose cells hold a file rather than typed text. */
export const ATTACHMENT_COLUMN_TYPES = ["image", "file"] as const;

export type AttachmentColumnType = (typeof ATTACHMENT_COLUMN_TYPES)[number];

/** Whether a column's cells take an uploaded file. */
export function isAttachmentColumnType(
  dataType: DatasetColumnType | undefined,
): dataType is AttachmentColumnType {
  return dataType === "image" || dataType === "file";
}

/**
 * Reads a picked file into the base64 data URL the upload procedure takes.
 *
 * Refuses a file over the cap before reading it: the read itself would hold
 * the whole file plus a third again as text in the tab's memory.
 */
export async function readDatasetAttachmentFile(
  file: File,
): Promise<Omit<UploadDatasetAttachmentInput, "projectId">> {
  if (file.size > DATASET_ATTACHMENT_MAX_BYTES) {
    throw new DatasetAttachmentTooLargeError();
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new DatasetAttachmentUnreadableError());
    reader.onload = () => {
      if (typeof reader.result === "string" && reader.result.startsWith("data:")) {
        resolve(reader.result);
        return;
      }
      reject(new DatasetAttachmentUnreadableError());
    };
    reader.readAsDataURL(file);
  });

  return { fileName: file.name || "file", dataUrl };
}

/**
 * The value the cell keeps for a stored attachment.
 *
 * An image cell keeps the bare reference, which is what every image detector in
 * the product already reads. A file cell keeps a markdown link, so the name the
 * reader uploaded survives a download to CSV and back.
 */
export function datasetAttachmentCellValue({
  dataType,
  attachment,
}: {
  dataType: AttachmentColumnType;
  attachment: DatasetAttachment;
}): string {
  return dataType === "file"
    ? datasetFileCellValue({ fileName: attachment.fileName, path: attachment.url })
    : attachment.url;
}

/**
 * The name to show for a file cell: the stored name, else the last segment of
 * the address. Null when the value names no file at all.
 */
export function datasetAttachmentDisplayName(value: string): string | null {
  const cell = parseDatasetFileCell(value);
  if (!cell) return null;
  if (cell.fileName) return cell.fileName;
  // A file pasted in as base64 carries no name and its address is the content.
  if (cell.url.startsWith("data:")) return "File";

  const withoutQuery = cell.url.split(/[?#]/)[0] ?? cell.url;
  const lastSegment = withoutQuery.split("/").at(-1) ?? "";
  if (lastSegment.length === 0) return cell.url;

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

/**
 * The address the cell opens for the file it holds.
 *
 * A stored file is served by its identifier and the store keeps no name for it,
 * so the browser would offer to save it as a long identifier. The serving route
 * takes the name as a query instead, and the cell already knows it. Only a
 * stored reference is given one: an outside address belongs to whoever serves
 * it, and its query is not ours to add to. The cell value itself never changes.
 */
export function datasetAttachmentOpenUrl(value: string): string | null {
  const cell = parseDatasetFileCell(value);
  if (!cell) return null;

  const reference = parseDatasetAttachmentReference(value);
  if (!reference || !cell.fileName) return cell.url;

  return `${reference.path}?filename=${encodeURIComponent(cell.fileName)}`;
}
