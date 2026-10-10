/** Parse only header (avoid OOM on multi-GB files). Canonicalise with
 * dedupeHeaders + renameReservedColumns so normalize honors columnTypes by index.
 */

import {
  type DatasetColumnType,
  type DatasetConfirmColumns,
  dedupeHeaders,
  detectFileFormat,
  type FileFormat,
  renameReservedColumns,
} from "@langwatch/dataset-contract";
import Papa from "papaparse";

/**
 * How many leading bytes of the file to read for the header. A header row /
 * first object is tiny; 256 KB comfortably covers pathologically wide schemas
 * while keeping the read (and a worst-case truncated-JSON scan) cheap.
 */
export const HEADER_PARSE_MAX_BYTES = 256 * 1024;

const DEFAULT_TYPE: DatasetColumnType = "string";

/** Wrap raw header names as default-`string` columns (the user picks types).
 *  `sourceHeader` is the canonical header itself, captured immutably so the
 *  confirm UI can rename/reorder while normalize still binds each file header
 *  to its column by header (not by position). */
const toColumns = (rawHeaders: string[], format: FileFormat): DatasetConfirmColumns => {
  // CSV maps rows to objects by index, so duplicate headers must be deduped the
  // same way normalize does; JSON/JSONL keys are already unique (an object can't
  // repeat a key) so only reserved-renaming applies — mirroring the job exactly.
  const canonical =
    format === "csv"
      ? renameReservedColumns(dedupeHeaders(rawHeaders))
      : renameReservedColumns(rawHeaders);
  return canonical
    .filter((name) => name.trim() !== "")
    .map((name) => ({ name, type: DEFAULT_TYPE, sourceHeader: name }));
};

/** First non-empty line of a (possibly truncated) text slice. */
const firstNonEmptyLine = (text: string): string | null => {
  for (const line of text.split("\n")) {
    if (line.trim() !== "") return line;
  }
  return null;
};

/**
 * Extract the first complete top-level `{…}` object from a `.json` array
 * slice by brace-matching (the slice usually truncates the array, so
 * `JSON.parse` fails whole). String-literal aware; null if none fits.
 */
const firstJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let isInString = false;
  let isEscaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (isInString) {
      if (isEscaped) isEscaped = false;
      else if (ch === "\\") isEscaped = true;
      else if (ch === '"') isInString = false;
      continue;
    }
    if (ch === '"') isInString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

const keysOf = (value: unknown): string[] | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : null;

export async function parseHeaderColumns(file: File): Promise<DatasetConfirmColumns | null> {
  let format: FileFormat;
  try {
    format = detectFileFormat(file.name);
  } catch {
    return null; // unsupported extension — caller skips confirm
  }

  const text = await file.slice(0, HEADER_PARSE_MAX_BYTES).text();

  if (format === "csv") {
    const parsed = Papa.parse<string[]>(text, {
      header: false,
      skipEmptyLines: "greedy",
      preview: 1,
    });
    const rawHeaders = parsed.data[0];
    if (!rawHeaders || rawHeaders.length === 0) return null;
    const columns = toColumns(
      rawHeaders.map((h) => (h == null ? "" : String(h))),
      format,
    );
    return columns.length > 0 ? columns : null;
  }

  const keys = format === "jsonl" ? jsonlHeaderKeys(text) : jsonHeaderKeys(text);
  if (keys.length === 0) return null;
  const columns = toColumns(keys, format);
  return columns.length > 0 ? columns : null;
}

const jsonlHeaderKeys = (text: string): string[] => {
  const line = firstNonEmptyLine(text);
  if (!line) return [];
  try {
    return keysOf(JSON.parse(line)) ?? [];
  } catch {
    return []; // first object didn't fit the slice / not an object
  }
};

// A single array. The slice usually truncates it, so parse the whole slice
// first (small files), else brace-match the first object.
const jsonHeaderKeys = (text: string): string[] => {
  try {
    const whole = JSON.parse(text);
    return Array.isArray(whole) ? (keysOf(whole[0]) ?? []) : [];
  } catch {
    return firstJsonObjectKeys(text);
  }
};

const firstJsonObjectKeys = (text: string): string[] => {
  const objText = firstJsonObject(text);
  if (!objText) return [];
  try {
    return keysOf(JSON.parse(objText)) ?? [];
  } catch {
    return [];
  }
};
