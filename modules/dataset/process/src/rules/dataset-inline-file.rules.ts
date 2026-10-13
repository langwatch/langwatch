/**
 * Reading a cell value that carries a whole file inline, as a base64 data URL.
 * @see specs/datasets/dataset-attachments.feature
 */

const DATA_URL_PREFIX = "data:";

/** How far into a value the data URL header is looked for; the header is a few dozen characters. */
const HEADER_SCAN_LENGTH = 512;

type InlineFile =
  | {
      kind: "base64";
      /** The declared media type, lower-cased, without parameters; empty when none was declared. */
      mediaType: string;
      /** Where the base64 payload starts in the value. */
      payloadStart: number;
      /** How many bytes the payload decodes to when it is well formed. */
      byteLength: number;
    }
  | { kind: "unreadable" };

/** True for a value that starts as a data URL, whatever it holds. */
export function isInlineFileValue(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(DATA_URL_PREFIX);
}

/**
 * The header of an inline file, read without scanning its payload: a base64
 * data URL names its size by its length alone.
 */
export function readInlineFile(value: string): InlineFile {
  const head = value.slice(0, HEADER_SCAN_LENGTH);
  const comma = head.indexOf(",");
  if (!head.startsWith(DATA_URL_PREFIX) || comma === -1) return { kind: "unreadable" };

  const [mediaType = "", ...parameters] = head.slice(DATA_URL_PREFIX.length, comma).split(";");
  const base64 = parameters.some((parameter) => parameter.trim().toLowerCase() === "base64");
  if (!base64) return { kind: "unreadable" };

  const payloadStart = comma + 1;
  let payloadEnd = value.length;
  while (payloadEnd > payloadStart && value.charCodeAt(payloadEnd - 1) === 61) payloadEnd--;
  const payloadLength = payloadEnd - payloadStart;
  if (payloadLength === 0) return { kind: "unreadable" };

  return {
    kind: "base64",
    mediaType: mediaType.trim().toLowerCase(),
    payloadStart,
    byteLength: Math.floor((payloadLength * 3) / 4),
  };
}

/** The file's bytes, or null when the payload holds anything that is not base64. */
export function decodeInlineFile(
  value: string,
  file: Extract<InlineFile, { kind: "base64" }>,
): Buffer | null {
  const bytes = Buffer.from(value.slice(file.payloadStart), "base64");

  // The decoder skips what it cannot read, so a short answer means a damaged payload.
  return bytes.byteLength === file.byteLength ? bytes : null;
}

const COLUMN_NAME_LENGTH = 96;

const EXTENSION_BY_SUBTYPE: Readonly<Record<string, string>> = {
  jpeg: "jpg",
  "svg+xml": "svg",
  plain: "txt",
  mpeg: "mp3",
  quicktime: "mov",
};

/** The name a stored inline file gets: the column it sat in, with an ending for its media type. */
export function inlineFileNameOf(column: string, mediaType: string): string {
  const subtype = mediaType.split("/")[1] ?? "";
  const extension =
    EXTENSION_BY_SUBTYPE[subtype] ?? (/^[a-z0-9]+$/.test(subtype) ? subtype : "bin");

  // The served name is cut to a fixed length, so the column part leaves room for the ending.
  return `${column.slice(0, COLUMN_NAME_LENGTH)}.${extension}`;
}

/** A per-file limit asked for at most once, however many files a write carries. */
export function onceMaxBytes(resolve: () => Promise<number>): () => Promise<number> {
  let pending: Promise<number> | undefined;

  return () => (pending ??= resolve());
}
