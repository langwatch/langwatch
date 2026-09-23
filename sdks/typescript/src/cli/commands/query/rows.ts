/**
 * A query result as the bytes a caller asked for: `table` for a person,
 * `json`/`jsonl`/`csv` for a program, a JSON column a real array.
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
 * ClickHouse types whose values arrive as a JSON string. The column's declared
 * type decides, never the value: a captured output of `"[1, 2]"` is the model's
 * own text, and parsing it because it parses rewrites what it produced.
 */
const JSON_TYPE_PATTERN = /(^|\()(JSON|Object\('json'\))/i;

function isJsonColumn(column: QueryColumn): boolean {
  return JSON_TYPE_PATTERN.test(column.type);
}

/**
 * One cell, with a JSON-typed column parsed back. A JSON column that does not
 * parse is written through as the string it is: refusing the row would lose
 * the other columns of a row that is otherwise fine.
 */
function machineValue({ column, value }: { column: QueryColumn; value: unknown }): unknown {
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
  return rows.map((row) => JSON.stringify(machineRow({ columns, row }))).join("\n");
}

/**
 * One cell of CSV: quoted whenever the value carries a comma, a quote, a
 * newline or a carriage return, with embedded quotes doubled (RFC 4180). The
 * carriage return is the one a hand-rolled exporter forgets.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? value : (JSON.stringify(value) ?? "");
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
    columns.map((column) => csvCell(machineValue({ column, value: row[column.name] }))).join(","),
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
