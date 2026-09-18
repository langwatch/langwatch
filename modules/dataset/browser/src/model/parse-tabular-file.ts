/** Parse dropped CSV/JSON/JSONL as header+body rows. Convert JSON/JSONL to
 * CSV first so one reader handles all.
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
