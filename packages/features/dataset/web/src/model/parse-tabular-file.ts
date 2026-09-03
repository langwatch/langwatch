/**
 * A dropped CSV, JSON or JSONL file, as header-plus-body rows.
 *
 * A family-local copy of `parseFileToRows` / `jsonFileTextToCSV` /`jsonToCSV`
 * from `platform/app/src/components/datasets/UploadCSVDrawer`, which the upload
 * drawer's no-storage fallback still calls. Deletes-only forbids repointing it,
 * so the platform copies stay for that flow and this one travels with the CSV
 * append modal.
 *
 * PapaParse does the CSV work in both directions, so JSON and JSONL are handled
 * by turning them into CSV text first rather than by a second row builder: one
 * reader means one answer for quoting, embedded newlines and empty trailing
 * lines.
 */

import Papa from "papaparse";

/** Every well-formed CSV ends with a newline; without this the final line
 *  parses as `[""]` and would append an empty record. */
const PARSE_CONFIG = { skipEmptyLines: "greedy" } as const;

export async function parseTabularFileToRows(file: File): Promise<string[][]> {
  const isJson = file.name.endsWith(".json") || file.name.endsWith(".jsonl");
  const csvText = isJson ? jsonTextToCsv(await file.text()) : await file.text();

  return new Promise<string[][]>((resolve, reject) => {
    Papa.parse<string[]>(csvText, {
      ...PARSE_CONFIG,
      complete: (results) => resolve(results.data),
      error: (error: Error) => reject(error),
    });
  });
}

/** JSON or JSONL text as CSV text (header + rows). */
export function jsonTextToCsv(contents: string): string {
  let parsed: object[];
  try {
    parsed = JSON.parse(contents) as object[];
  } catch {
    // Not valid JSON; read it as JSONL, one object per line.
    parsed = JSON.parse(
      "[" +
        contents
          .trim()
          .split("\n")
          .filter((line) => line.trim() !== "")
          .join(", ") +
        "]",
    ) as object[];
  }

  // A nested value has no column of its own, so it travels as its JSON text
  // rather than as `[object Object]`.
  const flattened = parsed.map((item) =>
    Object.fromEntries(
      Object.entries(item).map(([key, value]) =>
        value && typeof value === "object" ? [key, JSON.stringify(value)] : [key, value],
      ),
    ),
  );
  const columns = new Set(flattened.flatMap((item) => Object.keys(item)));

  return Papa.unparse(flattened, { columns: Array.from(columns) });
}

/** A file size, spelled the way the upload rows spell it. */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";
  const units = ["Bytes", "KB", "MB", "GB", "TB"] as const;
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, exponent);
  return `${parseFloat(value.toFixed(2))} ${units[exponent]}`;
}
