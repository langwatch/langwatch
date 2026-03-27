import Papa from "papaparse";
import {
  getSafeColumnName,
  isReservedColumnName,
} from "~/components/datasets/utils/reservedColumns";
import type { DatasetColumns } from "./types";

/**
 * Maximum number of rows allowed per file upload.
 */
export const MAX_ROWS_LIMIT = 10_000;

/**
 * Maximum file size in bytes (25 MB).
 */
export const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

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
      if (type === "number") {
        if (!value && value !== 0) {
          convertedRecord[key] = null;
        } else if (!isNaN(value as number)) {
          convertedRecord[key] = parseFloat(String(value));
        }
      } else if (type === "boolean") {
        const strValue = `${value ?? ""}`.toLowerCase();
        if (["true", "1", "yes", "y", "on", "ok"].includes(strValue)) {
          convertedRecord[key] = true;
        } else if (
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
          convertedRecord[key] = false;
        }
      } else if (type === "date") {
        const dateAttempt = new Date(value as string);
        if (dateAttempt.toString() !== "Invalid Date") {
          convertedRecord[key] = dateAttempt.toISOString().split("T")[0];
        }
      } else if (type === "image") {
        // Image type is treated as a string (URL)
        convertedRecord[key] = value;
      } else if (type !== "string" && type !== undefined) {
        // For json, list, spans, etc. — try parsing the string as JSON
        try {
          convertedRecord[key] = JSON.parse(value as string);
        } catch {
          // Keep original value if JSON parse fails
        }
      }
    }
    return convertedRecord;
  });
}

/**
 * Parses file content based on the detected format.
 * Returns headers (column names) and rows.
 */
export function parseFileContent(params: {
  content: string;
  format: FileFormat;
}): { headers: string[]; rows: Record<string, unknown>[] } {
  const { content, format } = params;

  switch (format) {
    case "csv": {
      const result = parseCSV(content);
      return { headers: result.headers, rows: result.rows };
    }
    case "json": {
      const records = parseJSON(content);
      const headers =
        records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
    case "jsonl": {
      const records = parseJSONL(content);
      const headers =
        records.length > 0 ? Object.keys(records[0]!) : [];
      return { headers, rows: records };
    }
  }
}
