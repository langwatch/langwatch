/**
 * The flags of `langwatch query`, resolved into the request's own types and
 * refused where they cannot mean anything — before any credential is read.
 * The command is then only the two execution shapes.
 * @see specs/analytics/lwql-cli-query.feature
 */

import { readFileSync } from "node:fs";

import chalk from "chalk";

import { formatTable } from "../../utils/formatting";
import {
  type QueryColumn,
  type QueryOutputFormat,
  QUERY_OUTPUT_FORMATS,
  type QueryRow,
} from "./rows";

/** Rows a table prints before it stops being a table. */
const TABLE_ROW_CAP = 200;

export type ParameterValue = string | number | boolean | null;

export function refuse(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

/** The statement, from the argument or the file, never from both. */
export function resolveStatement({ sql, sqlFile }: { sql?: string; sqlFile?: string }): string {
  if (sql !== undefined && sqlFile !== undefined) {
    refuse("give a statement or --sql-file, not both");
  }
  if (sqlFile !== undefined) {
    try {
      return readFileSync(sqlFile, "utf-8");
    } catch {
      refuse(`could not read --sql-file ${sqlFile}`);
    }
  }
  if (sql === undefined || sql.trim().length === 0) {
    refuse(
      'give a statement: langwatch query "SELECT count() FROM analytics.traces WHERE OccurredAt >= subtractDays(now(), 1)"',
    );
  }
  return sql;
}

/**
 * `--param k=v` into bound parameters. Values stay strings: the type is
 * declared inside the statement (`{days:UInt32}`), so guessing one here could
 * only disagree with the author's.
 */
export function resolveParameters(pairs: readonly string[] = []): Record<string, ParameterValue> {
  const parameters: Record<string, ParameterValue> = {};
  for (const pair of pairs) {
    const separator = pair.indexOf("=");
    if (separator <= 0) {
      refuse(`--param needs key=value, got "${pair}"`);
    }
    parameters[pair.slice(0, separator)] = pair.slice(separator + 1);
  }
  return parameters;
}

/** Whether a flag's value is one of the formats this command writes. */
function isQueryOutputFormat(format: string): format is QueryOutputFormat {
  return QUERY_OUTPUT_FORMATS.some((offered) => offered === format);
}

export function resolveFormat(format = "table"): QueryOutputFormat {
  if (!isQueryOutputFormat(format)) {
    refuse(`--format must be one of ${QUERY_OUTPUT_FORMATS.join(", ")}`);
  }
  return format;
}

export function resolveLimit(limit?: string): number | undefined {
  if (limit === undefined) return undefined;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    refuse("--limit must be a whole number of at least 1");
  }
  return parsed;
}

/** The window, honoured only when both ends are given. */
export function resolveTimeWindow({
  start,
  end,
}: {
  start?: string;
  end?: string;
}): { start: string; end: string } | undefined {
  if (start === undefined && end === undefined) return undefined;
  if (start === undefined || end === undefined) {
    refuse("--start and --end must be given together");
  }
  return { start, end };
}

/** A cell as a table shows it: JSON for anything structured, blank for absent. */
function tableCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value as string | number | boolean);
}

export function printTable(result: {
  columns: readonly QueryColumn[];
  rows: readonly QueryRow[];
  statistics?: { elapsedMs: number };
  truncated?: boolean;
  diagnostics?: readonly { code: string; message: string }[];
}): void {
  console.log();
  if (result.rows.length === 0) {
    console.log(chalk.gray("The statement returned no rows."));
  } else {
    const headers = result.columns.map((column) => column.name);
    const shown = result.rows.slice(0, TABLE_ROW_CAP);
    formatTable({
      data: shown.map((row) =>
        Object.fromEntries(headers.map((name) => [name, tableCell(row[name])])),
      ),
      headers,
    });
    if (result.rows.length > shown.length) {
      console.log();
      console.log(
        chalk.gray(
          `Showing ${shown.length} of ${result.rows.length} rows. Use --format jsonl or -o file for all of them.`,
        ),
      );
    }
  }
  if (result.truncated) {
    console.log();
    console.log(
      chalk.yellow(
        "The result hit a response ceiling and was cut short. Aggregate further, or page with --page-by keyset.",
      ),
    );
  }
  for (const diagnostic of result.diagnostics ?? []) {
    console.log();
    console.log(chalk.yellow(`${diagnostic.code}: ${diagnostic.message}`));
  }
  console.log();
}

/**
 * The last row's cursor, read by NAME from the two columns the statement
 * projects under the cursor parameters: guessed from the row's shape, another
 * timestamp column would bind the wrong cursor and page over the wrong rows.
 */
