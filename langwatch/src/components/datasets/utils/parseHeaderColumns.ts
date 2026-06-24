/**
 * Header-only parse for the upload confirm step (ADR-032 v19).
 *
 * The direct-upload happy path never parses the whole file in the browser (a
 * multi-GB file would OOM the tab — the exact failure the direct upload avoids).
 * To still let the user confirm column names + types BEFORE uploading, we read
 * only a bounded leading slice of the file and extract the header row (CSV) or
 * the first object's keys (JSON / JSONL). The slice is canonicalised through the
 * SAME `dedupeHeaders` + `renameReservedColumns` the normalize job applies, so
 * the returned columns are positionally 1:1 with the headers normalize will
 * parse server-side — which is what lets normalize honour the confirmed
 * `columnTypes` by index.
 *
 * Returns `null` when the header can't be determined (empty file, unsupported
 * extension, or a `.json` array whose first object doesn't fit the slice). The
 * caller then uploads without a confirm step and normalize derives all-`string`
 * columns, exactly as before — a graceful degradation, never an error.
 */

import Papa from "papaparse";
import type {
  DatasetColumns,
  DatasetColumnType,
} from "~/server/datasets/types";
import {
  dedupeHeaders,
  detectFileFormat,
  type FileFormat,
  renameReservedColumns,
} from "~/server/datasets/upload-utils";

/**
 * How many leading bytes of the file to read for the header. A header row /
 * first object is tiny; 256 KB comfortably covers pathologically wide schemas
 * while keeping the read (and a worst-case truncated-JSON scan) cheap.
 */
export const HEADER_PARSE_MAX_BYTES = 256 * 1024;

const DEFAULT_TYPE: DatasetColumnType = "string";

/** Wrap raw header names as default-`string` columns (the user picks types). */
const toColumns = (
  rawHeaders: string[],
  format: FileFormat,
): DatasetColumns => {
  // CSV maps rows to objects by index, so duplicate headers must be deduped the
  // same way normalize does; JSON/JSONL keys are already unique (an object can't
  // repeat a key) so only reserved-renaming applies — mirroring the job exactly.
  const canonical =
    format === "csv"
      ? renameReservedColumns(dedupeHeaders(rawHeaders))
      : renameReservedColumns(rawHeaders);
  return canonical
    .filter((name) => name.trim() !== "")
    .map((name) => ({ name, type: DEFAULT_TYPE }));
};

/** First non-empty line of a (possibly truncated) text slice. */
const firstNonEmptyLine = (text: string): string | null => {
  for (const line of text.split("\n")) {
    if (line.trim() !== "") return line;
  }
  return null;
};

/**
 * Extract the first complete top-level `{…}` object from a `.json` array slice
 * by brace-matching (the slice usually truncates the array, so `JSON.parse` of
 * the whole slice fails). String-literal aware so braces inside values don't
 * miscount. Returns null if no complete object fits the slice.
 */
const firstJsonObject = (text: string): string | null => {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
};

const keysOf = (value: unknown): string[] | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value as Record<string, unknown>)
    : null;

export async function parseHeaderColumns(
  file: File,
): Promise<DatasetColumns | null> {
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

  if (format === "jsonl") {
    const line = firstNonEmptyLine(text);
    if (!line) return null;
    try {
      const keys = keysOf(JSON.parse(line));
      if (!keys || keys.length === 0) return null;
      const columns = toColumns(keys, format);
      return columns.length > 0 ? columns : null;
    } catch {
      return null; // first object didn't fit the slice / not an object
    }
  }

  // format === "json": a single array. The slice usually truncates it, so parse
  // the whole slice first (small files), else brace-match the first object.
  let keys: string[] | null = null;
  try {
    const whole = JSON.parse(text);
    if (Array.isArray(whole)) keys = keysOf(whole[0]);
  } catch {
    const objText = firstJsonObject(text);
    if (objText) {
      try {
        keys = keysOf(JSON.parse(objText));
      } catch {
        keys = null;
      }
    }
  }
  if (!keys || keys.length === 0) return null;
  const columns = toColumns(keys, format);
  return columns.length > 0 ? columns : null;
}
