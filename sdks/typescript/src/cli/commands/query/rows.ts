/**
 * Turning a query result into the bytes a caller asked for.
 *
 * Four formats and one rule between them: `table` is for a person, and
 * `json` / `jsonl` / `csv` are for a program or a file. The split matters
 * because the interesting case is not pretty-printing — it is the export. A
 * post-training pull wants one JSON object per line with `messages` as a real
 * array, not as a string holding a JSON array, and getting that right is the
 * difference between a usable `train.jsonl` and one every reader has to parse
 * twice.
 *
 * Kept out of the command so both the single run and the keyset walk write
 * identically, and so the escaping rules are testable without a spinner.
 *
 * @see specs/analytics/lwql-cli-query.feature
 */

/** What a caller can ask for. `table` is the only one meant for a person. */
export const QUERY_OUTPUT_FORMATS = ["table", "json", "jsonl", "csv"] as const;

export type QueryOutputFormat = (typeof QUERY_OUTPUT_FORMATS)[number];

/** A result column, as the query endpoint describes it. */
export interface QueryColumn {
  name: string;
  type: string;
}

export type QueryRow = Record<string, unknown>;

/**
 * ClickHouse types whose values arrive as a JSON string.
 *
 * The reason this list exists rather than a `JSON.parse` attempt on every
 * string: a value that merely LOOKS like JSON must survive. A captured output
 * of `"[1, 2]"` is the model's own text, and parsing it because it parses would
 * silently change what the export says the model produced. So the column's
 * declared type decides, never the value.
 */
const JSON_TYPE_PATTERN = /(^|\()(JSON|Object\('json'\))/i;

function isJsonColumn(column: QueryColumn): boolean {
  return JSON_TYPE_PATTERN.test(column.type);
}

/**
 * The value to write for one cell, with a JSON-typed column parsed back.
 *
 * A JSON column that does not parse is written through as the string it is:
 * the export's job is to carry what the database returned, and refusing a row
 * because one cell is malformed would lose the other columns of a row that is
 * otherwise fine.
 */
function machineValue({
  column,
  value,
}: {
  column: QueryColumn;
  value: unknown;
}): unknown {
  if (!isJsonColumn(column) || typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

/** One row as a plain object, JSON-typed columns parsed back. */
export function machineRow({
  columns,
  row,
}: {
  columns: readonly QueryColumn[];
  row: QueryRow;
}): QueryRow {
  const out: QueryRow = {};
  for (const column of columns) {
    out[column.name] = machineValue({ column, value: row[column.name] });
  }
  return out;
}

/** One JSON object per line, which is what a training-data reader expects. */
export function renderJsonl({
  columns,
  rows,
}: {
  columns: readonly QueryColumn[];
  rows: readonly QueryRow[];
}): string {
  return rows
    .map((row) => JSON.stringify(machineRow({ columns, row })))
    .join("\n");
}

/**
 * One cell of CSV.
 *
 * Quoted whenever the value carries a comma, a quote, a newline or a carriage
 * return, with embedded quotes doubled — RFC 4180, and the one place a
 * hand-rolled exporter usually gets it wrong is the carriage return, which
 * splits the row for a reader on Windows even though it looks like nothing.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function renderCsv({
  columns,
  rows,
}: {
  columns: readonly QueryColumn[];
  rows: readonly QueryRow[];
}): string {
  const header = columns.map((column) => csvCell(column.name)).join(",");
  const body = rows.map((row) =>
    columns
      .map((column) => csvCell(machineValue({ column, value: row[column.name] })))
      .join(","),
  );
  return [header, ...body].join("\n");
}

/** Every row as one JSON array, for a caller that wants to read it whole. */
export function renderJson({
  columns,
  rows,
}: {
  columns: readonly QueryColumn[];
  rows: readonly QueryRow[];
}): string {
  return JSON.stringify(
    rows.map((row) => machineRow({ columns, row })),
    null,
    2,
  );
}

/** The bytes for one of the machine formats. */
export function renderRows({
  format,
  columns,
  rows,
}: {
  format: Exclude<QueryOutputFormat, "table">;
  columns: readonly QueryColumn[];
  rows: readonly QueryRow[];
}): string {
  if (format === "jsonl") return renderJsonl({ columns, rows });
  if (format === "csv") return renderCsv({ columns, rows });
  return renderJson({ columns, rows });
}
