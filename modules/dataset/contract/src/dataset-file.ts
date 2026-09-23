import { resolveRequestBound } from "@langwatch/plans";
import { fromDate, Temporal, toDate, toEpochMs } from "@langwatch/time";
import Papa from "papaparse";

import type { DatasetColumns } from "./dataset.ts";

const getSafeColumnName = (columnName: string, existingNames: Set<string>): string => {
  const reserved = (value: string) => value === "id" || value === "selected";
  const reservedColumnName = reserved(columnName.toLowerCase());
  if (reservedColumnName) {
    return getSuffixedColumnName(columnName, existingNames, reserved);
  }

  if (!existingNames.has(columnName)) return columnName;

  return getSuffixedColumnName(columnName, existingNames, reserved);
};

const getSuffixedColumnName = (
  columnName: string,
  existingNames: Set<string>,
  reserved: (value: string) => boolean,
): string => {
  let candidate = `${columnName}_`;
  let counter = 0;
  let unavailable = true;
  while (unavailable) {
    const reservedCandidate = reserved(candidate.toLowerCase());
    const existingCandidate = existingNames.has(candidate);
    unavailable = reservedCandidate || existingCandidate;
    if (!unavailable) break;

    counter += 1;
    candidate = `${columnName}_${counter}`;
  }
  return candidate;
};

/**
 * Maximum number of rows allowed per file upload. The request-bounds registry
 * owns the number; both tiers quoted there are the same, so any tier answers
 * it — "FREE" is only the spelling of "the tier-agnostic value".
 */
export const MAX_ROWS_LIMIT = resolveRequestBound("datasetRowsMax", "FREE");

/**
 * Maximum file size in bytes (25 MB), measured on the server after the
 * content arrives — the client-stated size is not trusted. Same registry
 * derivation as {@link MAX_ROWS_LIMIT}.
 */
export const MAX_FILE_SIZE_BYTES = resolveRequestBound("datasetFileBytes", "FREE");

// JSON.parse rejects U+0000 null bytes in string literals ("Bad control
// character"), even though Postgres-bound payloads only break later. Scrub
// them from raw content first (PDF copy-paste, broken CSV exports) so
// uploads don't crash; the record sanitiser below catches any that survive.
function stripRawNullBytes(content: string): string {
  return content.includes("\u0000") ? content.replaceAll("\u0000", "") : content;
}

export type FileFormat = "csv" | "json" | "jsonl";

/**
 * Detects the file format from the file extension.
 * @throws Error if the format is unsupported
 */
export function detectFileFormat(filename: string): FileFormat {
  const extension = filename.split(".").pop()?.toLowerCase();

  switch (extension) {
    case "csv":
      return "csv";
    case "json":
      return "json";
    case "jsonl":
      return "jsonl";
    default:
      throw new Error(
        `Unsupported file format: .${extension ?? "unknown"}. Supported formats: .csv, .json, .jsonl`,
      );
  }
}

/**
 * Parses a CSV string into headers and row objects.
 * Uses papaparse with first row as headers.
 */
export function parseCSV(content: string): {
  headers: string[];
  rows: Record<string, string>[];
} {
  const result = Papa.parse<Record<string, string>>(content.trim(), {
    header: true,
    skipEmptyLines: true,
  });

  const headers = result.meta.fields ?? [];
  return { headers, rows: result.data };
}

/**
 * Parses a JSON string as an array of objects.
 * @throws Error if the content is not valid JSON or not an array
 */
export function parseJSON(content: string): Record<string, unknown>[] {
  const parsed = JSON.parse(content.trim());
  if (!Array.isArray(parsed)) {
    throw new Error("JSON content must be an array of objects");
  }
  return parsed as Record<string, unknown>[];
}

/**
 * Parses a JSONL string (one JSON object per line).
 * Falls back to JSON array parsing if JSONL parsing fails.
 * Skips blank lines.
 */
export function parseJSONL(content: string): Record<string, unknown>[] {
  const trimmed = content.trim();

  // Try JSON array first (fallback)
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed as Record<string, unknown>[];
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) {
      throw error;
    }
  }

  // Parse line-by-line
  const lines = trimmed.split("\n");
  const records: Record<string, unknown>[] = [];

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (trimmedLine === "") continue;
    records.push(JSON.parse(trimmedLine) as Record<string, unknown>);
  }

  return records;
}

/**
 * Renames reserved column names (e.g. "id" → "id_", "selected" → "selected_").
 * Uses the existing reserved column utilities to ensure consistency.
 */
export function renameReservedColumns(columns: string[]): string[] {
  const renamedSet = new Set<string>();
  return columns.map((col) => {
    const safeName = getSafeColumnName(col, renamedSet);
    renamedSet.add(safeName);
    return safeName;
  });
}

/** Dedup headers identically browser-side (ADR-032): confirmed columnTypes
 * stay in sync by index with server parsing. */
export function dedupeHeaders(headers: string[]): string[] {
  const seen = new Map<string, number>();
  // Track the names actually emitted, not just the raw inputs: a suffixed
  // candidate (`col_1`) can still collide with a column literally named `col_1`,
  // so keep bumping the counter until the candidate is unique. Without this,
  // `["col","col","col_1"]` would emit `["col","col_1","col_1"]` and a by-index
  // record map would silently overwrite one column's values with another's.
  const emitted = new Set<string>();
  return headers.map((header) => {
    let count = seen.get(header) ?? 0;
    let candidate = count === 0 ? header : `${header}_${count}`;
    while (emitted.has(candidate)) {
      candidate = `${header}_${++count}`;
    }
    seen.set(header, count + 1);
    emitted.add(candidate);
    return candidate;
  });
}

/** Convert one cell to its declared type. Factored from
 * convertRowsToColumnTypes so streaming normalize can apply confirmed types.
 */
export function convertValueToColumnType(
  value: unknown,
  type: DatasetColumns[number]["type"],
): unknown {
  if (type === "number") return convertNumberValue(value);
  if (type === "boolean") return convertBooleanValue(value);
  if (type === "date") return convertDateValue(value);

  // Image is a URL string; string passes through unchanged.
  if (type === "image" || type === "string" || type === undefined) {
    return value;
  }
  // list / json / spans / chat_messages / annotations / evaluations — parse JSON,
  // keeping the original value if it isn't valid JSON.
  try {
    return JSON.parse(value as string);
  } catch {
    return value;
  }
}

function convertNumberValue(value: unknown): unknown {
  if (!value && value !== 0) return null;
  if (typeof value === "string" && !isNaN(Number(value))) return parseFloat(value);
  return value;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function convertBooleanValue(value: unknown): unknown {
  const strValue = cellText(value).toLowerCase();
  if (["true", "1", "yes", "y", "on", "ok"].includes(strValue)) return true;
  if (["false", "0", "null", "undefined", "nan", "inf", "no", "n", "off"].includes(strValue)) {
    return false;
  }
  return value;
}

function convertDateValue(value: unknown): unknown {
  // Preserve empty/missing cells: `new Date(null)` is the Unix epoch, which
  // would silently rewrite a nullable date column's blanks to 1970-01-01.
  if (value === null || value === undefined || value === "") return value;

  const timeInput = value instanceof Date ? fromDate(value) : value;
  if (
    typeof timeInput !== "string" &&
    typeof timeInput !== "number" &&
    !(timeInput instanceof Temporal.Instant)
  ) {
    return value;
  }

  const epochMs =
    timeInput instanceof Temporal.Instant ? timeInput.epochMilliseconds : toEpochMs(timeInput);
  return Number.isFinite(epochMs)
    ? toDate(Temporal.Instant.fromEpochMilliseconds(epochMs)).toISOString().split("T")[0]
    : value;
}

/**
 * Converts row values to match declared column types — strings to
 * numbers, booleans, dates, or parsed JSON. Ported from the frontend's
 * `tryToConvertRowsToAppropriateType`.
 */
export function convertRowsToColumnTypes(
  rows: Record<string, unknown>[],
  columnTypes: DatasetColumns,
): Record<string, unknown>[] {
  const typeForColumn = Object.fromEntries(columnTypes.map((col) => [col.name, col.type]));

  return rows.map((record) => {
    const convertedRecord = { ...record };
    for (const [key, value] of Object.entries(record)) {
      const type = typeForColumn[key];
      if (type !== undefined) {
        convertedRecord[key] = convertValueToColumnType(value, type);
      }
    }
    return convertedRecord;
  });
}

/** Parse file content by format, scrubbing raw nulls before parse so
 * JSON.parse doesn't throw on customer U+0000 embeds (PDF copy-paste, etc).
 */
export function parseFileContent(params: { content: string; format: FileFormat }): {
  headers: string[];
  rows: Record<string, unknown>[];
} {
  const { content, format } = params;
  const cleanContent = stripRawNullBytes(content);

  switch (format) {
    case "csv": {
      const result = parseCSV(cleanContent);
      return { headers: result.headers, rows: result.rows };
    }
    case "json": {
      const records = parseJSON(cleanContent);
      const headers = records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
    case "jsonl": {
      const records = parseJSONL(cleanContent);
      const headers = records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
  }
}
