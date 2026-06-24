import Papa from "papaparse";
import { getSafeColumnName } from "~/components/datasets/utils/reservedColumns";
import type { DatasetColumns } from "./types";

/**
 * Maximum number of rows allowed per file upload.
 */
export const MAX_ROWS_LIMIT = 10_000;

/**
 * Maximum file size in bytes (25 MB).
 */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

// JSON.parse rejects U+0000 null bytes inside string literals as a
// "Bad control character" syntax error, even though Postgres-bound
// payloads only break later. Scrub null bytes from raw file content
// before any parser sees them so user-supplied uploads with stray
// null bytes (PDF copy-paste, broken CSV exports) no longer crash
// the upload pipeline. The dataset-record sanitiser below catches
// any null bytes that survive parsing (e.g. `\u0000` JSON escapes
// resolved to a real null after JSON.parse).
const NULL_BYTE_GLOBAL_RAW = /\u0000/g;
function stripRawNullBytes(content: string): string {
  return content.includes("\u0000")
    ? content.replace(NULL_BYTE_GLOBAL_RAW, "")
    : content;
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
  } catch {
    // Not a JSON array, continue with JSONL parsing
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

/**
 * Make column names unique by suffixing repeats `_1`, `_2`, … — the same scheme
 * papaparse's `header:true` dedup uses, but applied ONCE to the header row.
 *
 * Lives here (not in the normalize job) so the browser confirm step
 * (`parseHeaderColumns`) canonicalises the header EXACTLY as the server-side
 * normalize job does — the confirmed `columnTypes` are then positionally 1:1
 * with the headers normalize parses, which is what lets normalize honour them
 * by index (ADR-032 v19). The CSV normalize path parses with `header:false` and
 * maps rows by index precisely to AVOID papaparse re-running its dedup against
 * each data row under pause/resume backpressure (which corrupted equal-cell
 * rows with a `_1` suffix); deduping the header ourselves keeps the legitimate
 * "two columns named the same" rename without ever touching row values.
 */
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

/**
 * Convert one raw cell value to its declared column type (ADR-032 v19). The
 * single-value core of `convertRowsToColumnTypes` / the frontend
 * `tryToConvertRowsToAppropriateType`, factored out so the streaming normalize
 * job can apply a confirmed type per record without buffering rows.
 *
 * Mirrors the legacy semantics exactly: empty number → null; the same
 * truthy/falsy boolean token sets; date → ISO `YYYY-MM-DD`; image kept as a
 * string (URL); every other non-string type (list/json/spans/…) is JSON-parsed,
 * keeping the original string if the parse fails.
 */
export function convertValueToColumnType(
  value: unknown,
  type: DatasetColumns[number]["type"],
): unknown {
  if (type === "number") {
    if (!value && value !== 0) return null;
    return !isNaN(value as number) ? parseFloat(String(value)) : value;
  }
  if (type === "boolean") {
    const strValue = `${value ?? ""}`.toLowerCase();
    if (["true", "1", "yes", "y", "on", "ok"].includes(strValue)) return true;
    if (
      [
        "false",
        "0",
        "null",
        "undefined",
        "nan",
        "inf",
        "no",
        "n",
        "off",
      ].includes(strValue)
    ) {
      return false;
    }
    return value;
  }
  if (type === "date") {
    const dateAttempt = new Date(value as string);
    return dateAttempt.toString() !== "Invalid Date"
      ? dateAttempt.toISOString().split("T")[0]
      : value;
  }
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

/**
 * Converts row values to match declared column types.
 * Ported from frontend tryToConvertRowsToAppropriateType.
 *
 * Converts string values to numbers, booleans, dates, or parsed JSON
 * based on the declared column types.
 */
export function convertRowsToColumnTypes(
  rows: Record<string, unknown>[],
  columnTypes: DatasetColumns,
): Record<string, unknown>[] {
  const typeForColumn = Object.fromEntries(
    columnTypes.map((col) => [col.name, col.type]),
  );

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

/**
 * Parses file content based on the detected format.
 * Returns headers (column names) and rows.
 *
 * Raw null bytes are scrubbed before parsing so JSON.parse does not throw
 * on uploads where customers accidentally embed a U+0000 (PDF copy-paste,
 * broken CSV exports). The dataset-record sanitiser still runs later to
 * catch null bytes that appear via JSON escape sequences.
 */
export function parseFileContent(params: {
  content: string;
  format: FileFormat;
}): { headers: string[]; rows: Record<string, unknown>[] } {
  const { content, format } = params;
  const cleanContent = stripRawNullBytes(content);

  switch (format) {
    case "csv": {
      const result = parseCSV(cleanContent);
      return { headers: result.headers, rows: result.rows };
    }
    case "json": {
      const records = parseJSON(cleanContent);
      const headers =
        records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
    case "jsonl": {
      const records = parseJSONL(cleanContent);
      const headers =
        records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
  }
}
