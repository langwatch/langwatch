/**
 * Pure reading of what a browser sends when a person drops a file into a
 * dataset cell: the data URL it encodes the bytes in, the media type to keep
 * the object under, and the file name the cell displays.
 *
 * Everything here works on strings only. The decode, the size guard's verdict
 * and the write belong to `DatasetAttachmentService`.
 *
 * Spec: packages/features/dataset/specs/dataset-attachments.feature.
 */

/** The media type a file of unknown kind is kept under. */
export const DATASET_ATTACHMENT_FALLBACK_MEDIA_TYPE = "application/octet-stream";

/** The name a cell shows when nothing usable survives the clean-up. */
export const DATASET_ATTACHMENT_FALLBACK_FILE_NAME = "file";

/** How long a kept file name may be. A longer one is cut, keeping the extension. */
export const DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH = 120;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/** Punctuation a cell value or a `Content-Disposition` header must not carry. */
const UNSAFE_FILE_NAME_PUNCTUATION = new Set([
  '"',
  "[",
  "]",
  "(",
  ")",
  "<",
  ">",
  "|",
  ":",
  "*",
  "?",
]);

/** The lowest character a file name may keep: everything below it is a control character. */
const FIRST_PRINTABLE_CHARACTER = " ";

/** The one printable-range control character. */
const DELETE_CHARACTER = "\u007f";

/**
 * Media types by file extension, for the common case of a browser that sends
 * a generic binary because the operating system told it nothing better.
 */
const MEDIA_TYPE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bmp: "image/bmp",
  csv: "text/csv",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  m4a: "audio/mp4",
  md: "text/markdown",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  png: "image/png",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  svg: "image/svg+xml",
  tif: "image/tiff",
  tiff: "image/tiff",
  txt: "text/plain",
  wav: "audio/wav",
  webm: "video/webm",
  webp: "image/webp",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xml: "application/xml",
  yaml: "application/yaml",
  yml: "application/yaml",
  zip: "application/zip",
};

/** The parts of a base64 data URL the upload path reads. */
export type ParsedDataUrl = {
  /** The media type the browser declared, when it declared one. */
  mediaType?: string;
  /** The payload, whitespace removed, ready to decode. */
  base64: string;
};

/**
 * Reads a `data:<media type>;base64,<payload>` value. Any other shape, and any
 * payload that is not base64, reads as null: the caller refuses the upload.
 */
export function parseDataUrl(value: string): ParsedDataUrl | null {
  const trimmed = value.trim();
  if (!trimmed.startsWith("data:")) return null;

  const separator = trimmed.indexOf(",");
  if (separator < 0) return null;

  const parameters = trimmed.slice("data:".length, separator).split(";");
  if (!parameters.some((parameter) => parameter.trim().toLowerCase() === "base64")) return null;

  const base64 = trimmed.slice(separator + 1).replace(/\s+/g, "");
  if (base64.length === 0 || base64.length % 4 !== 0 || !BASE64_PATTERN.test(base64)) return null;

  const declared = (parameters[0] ?? "").trim().toLowerCase();
  return declared.includes("/") ? { mediaType: declared, base64 } : { base64 };
}

/**
 * How many bytes a base64 payload decodes to. Read before the decode, so a
 * body far over the limit is refused without allocating it.
 */
export function decodedByteLength(base64: string): number {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

/** The media type a file name suggests, when its extension is one we know. */
export function mediaTypeFromFileName(fileName: string): string | undefined {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension || extension === fileName.toLowerCase()) return undefined;
  return MEDIA_TYPE_BY_EXTENSION[extension];
}

/**
 * The media type to keep the bytes under. What the browser declared wins,
 * unless it declared the generic binary type, which says nothing.
 */
export function resolveAttachmentMediaType({
  declared,
  fileName,
}: {
  declared?: string;
  fileName: string;
}): string {
  if (declared && declared !== DATASET_ATTACHMENT_FALLBACK_MEDIA_TYPE) return declared;
  return mediaTypeFromFileName(fileName) ?? DATASET_ATTACHMENT_FALLBACK_MEDIA_TYPE;
}

/**
 * Reduces the name a browser reported to something safe to write into a cell
 * and into a `Content-Disposition` header: the last path segment only, no
 * control characters, no markdown link punctuation, and bounded in length.
 */
export function sanitizeAttachmentFileName(fileName: string): string {
  const lastSegment = fileName.split(/[/\\]/).pop() ?? "";
  const kept = Array.from(lastSegment)
    .filter(
      (character) =>
        character >= FIRST_PRINTABLE_CHARACTER &&
        character !== DELETE_CHARACTER &&
        !UNSAFE_FILE_NAME_PUNCTUATION.has(character),
    )
    .join("");
  const cleaned = kept.replace(/\s+/g, " ").trim().replace(/^\.+/, "").trim();

  if (cleaned.length === 0) return DATASET_ATTACHMENT_FALLBACK_FILE_NAME;
  if (cleaned.length <= DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH) return cleaned;

  const dot = cleaned.lastIndexOf(".");
  const extension = dot > 0 ? cleaned.slice(dot) : "";
  if (extension.length > 0 && extension.length < DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH) {
    return cleaned.slice(0, DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH - extension.length) + extension;
  }
  return cleaned.slice(0, DATASET_ATTACHMENT_FILE_NAME_MAX_LENGTH);
}
