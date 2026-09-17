/**
 * `langwatch query "<sql>"` — run one LangWatchQL statement.
 *
 * LangWatchQL reached the CLI only through a saved chart (`langwatch chart
 * run`), so a statement had to exist in the product before it could be run.
 * This runs one as written, under the same verbatim contract the REST door has.
 *
 * Two flags carry the export case, and they are the reason this is not just
 * `chart run` without an id.
 *
 * `--format jsonl` writes one JSON object per row with JSON-typed columns
 * parsed back, which is the shape a post-training reader wants and the shape a
 * table renderer cannot produce.
 *
 * `--page-by keyset` walks a result larger than one response by REBINDING the
 * statement's own cursor parameters between pages. The query endpoint has no
 * cursor of its own and this command rewrites nobody's SQL, so the paging lives
 * where it can: in a predicate the author wrote, over parameters the author
 * declared. The statement text is identical on every page.
 *
 * @see ../../../../../platform/app/src/server/analytics/lwql/examples — the
 *   keyset example this pages
 * @see specs/analytics/lwql-cli-query.feature
 */

import chalk from "chalk";
import { readFileSync, writeFileSync } from "node:fs";

import {
  type QueryRunResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";
import { resolveCredentials } from "../../utils/apiKey";
import { formatTable } from "../../utils/formatting";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import {
  type QueryColumn,
  type QueryOutputFormat,
  QUERY_OUTPUT_FORMATS,
  type QueryRow,
  renderRows,
} from "./rows";

/**
 * The cursor parameters `--page-by keyset` rebinds.
 *
 * Mirrors the names the platform's keyset example declares. They are a
 * convention rather than a contract the server enforces, which is exactly why
 * the command refuses a statement that does not declare both: silently running
 * page one over and over is the failure this prevents.
 */
const AFTER_TIMESTAMP_PARAMETER = "after_ts";
const AFTER_ID_PARAMETER = "after_id";

/** Where a keyset walk starts: before every row there could be. */
const KEYSET_START = {
  [AFTER_TIMESTAMP_PARAMETER]: "1970-01-01 00:00:00.000",
  [AFTER_ID_PARAMETER]: "",
} as const;

/** Pages a keyset walk will fetch before it stops on its own. */
const MAX_KEYSET_PAGES = 1_000;

/** Rows a table prints before it stops being a table. */
const TABLE_ROW_CAP = 200;

export interface QueryRunOptions {
  sqlFile?: string;
  start?: string;
  end?: string;
  param?: string[];
  limit?: string;
  format?: string;
  pageBy?: string;
  output?: string;
  project?: string;
}

type ParameterValue = string | number | boolean | null;

function refuse(message: string): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(1);
}

/** The statement, from the argument or the file, never from both. */
function resolveStatement({
  sql,
  sqlFile,
}: {
  sql?: string;
  sqlFile?: string;
}): string {
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
 * `--param k=v` into bound parameters.
 *
 * Values stay strings. A parameter's type is declared inside the statement
 * (`{days:UInt32}`) and the database coerces on that declaration, so guessing a
 * type here could only ever disagree with the one the author wrote.
 */
function resolveParameters(pairs: readonly string[] = []): Record<
  string,
  ParameterValue
> {
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

function resolveFormat(format = "table"): QueryOutputFormat {
  if (!(QUERY_OUTPUT_FORMATS as readonly string[]).includes(format)) {
    refuse(`--format must be one of ${QUERY_OUTPUT_FORMATS.join(", ")}`);
  }
  return format as QueryOutputFormat;
}

function resolveLimit(limit?: string): number | undefined {
  if (limit === undefined) return undefined;
  const parsed = Number(limit);
  if (!Number.isInteger(parsed) || parsed < 1) {
    refuse("--limit must be a whole number of at least 1");
  }
  return parsed;
}

/** The window, honoured only when both ends are given. */
function resolveTimeWindow({
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

function printTable(result: {
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
        Object.fromEntries(
          headers.map((name) => [name, tableCell(row[name])]),
        ),
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

/** The last row's cursor, for the next page's binding. */
function cursorFrom(rows: readonly QueryRow[]): {
  after_ts: string;
  after_id: string;
} | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const timestamp = Object.values(last).find(
    (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value),
  );
  const id = last.TraceId ?? last.traceId;
  return {
    after_ts:
      typeof timestamp === "string"
        ? timestamp
        : KEYSET_START[AFTER_TIMESTAMP_PARAMETER],
    after_id: typeof id === "string" ? id : "",
  };
}

/**
 * Walks every page of a keyset statement, rebinding the cursor.
 *
 * The cursor comes from the row the previous page ended on, so the walk needs
 * the ordering columns to be projected. `TraceId` and the first timestamp-shaped
 * value are what it reads; a statement ordering by anything else pages wrong,
 * which is why the reference's keyset example projects both.
 */
async function walkKeyset({
  service,
  sql,
  parameters,
  timeWindow,
  limit,
  onPage,
}: {
  service: QueryApiService;
  sql: string;
  parameters: Record<string, ParameterValue>;
  timeWindow?: { start: string; end: string };
  limit?: number;
  onPage: (page: QueryRunResult) => void;
}): Promise<{ pages: number; rows: number }> {
  if (!sql.includes(AFTER_TIMESTAMP_PARAMETER) || !sql.includes(AFTER_ID_PARAMETER)) {
    refuse(
      `--page-by keyset needs the statement to declare {${AFTER_TIMESTAMP_PARAMETER}:DateTime64(3)} and {${AFTER_ID_PARAMETER}:String} in its WHERE and to ORDER BY the same two columns. See \`langwatch query examples --tag paging\`.`,
    );
  }

  let cursor: { after_ts: string; after_id: string } = { ...KEYSET_START };
  let pages = 0;
  let rows = 0;
  let previousPageSize: number | null = null;

  while (pages < MAX_KEYSET_PAGES) {
    const page = await service.query({
      sql,
      parameters: { ...parameters, ...cursor },
      ...(timeWindow ? { timeWindow } : {}),
    });
    pages += 1;
    if (page.rows.length === 0) break;

    onPage(page);
    rows += page.rows.length;

    // A page shorter than the one before it is the end of the result: the
    // statement's own LIMIT is what sizes a full page, so the first short page
    // has nothing after it. Checking the ROW COUNT rather than asking for one
    // more row is what keeps the statement unrewritten.
    if (previousPageSize !== null && page.rows.length < previousPageSize) break;
    previousPageSize = page.rows.length;

    if (limit !== undefined && rows >= limit) break;

    const next = cursorFrom(page.rows);
    if (!next || (next.after_ts === cursor.after_ts && next.after_id === cursor.after_id)) {
      // The cursor did not move, so another page would repeat this one.
      break;
    }
    cursor = next;
  }

  return { pages, rows };
}

export const runQueryCommand = async (
  sql: string | undefined,
  options: QueryRunOptions = {},
): Promise<CommandResult | void> => {
  await resolveCredentials({ project: options.project });

  const statement = resolveStatement({ sql, sqlFile: options.sqlFile });
  const parameters = resolveParameters(options.param);
  const format = resolveFormat(options.format);
  const limit = resolveLimit(options.limit);
  const timeWindow = resolveTimeWindow(options);
  const pageByKeyset = options.pageBy === "keyset";
  if (options.pageBy !== undefined && !pageByKeyset) {
    refuse("--page-by only understands `keyset`");
  }

  const service = new QueryApiService();
  const spinner = createSpinner("Running statement...").start();

  try {
    if (pageByKeyset) {
      const chunks: string[] = [];
      let columns: readonly QueryColumn[] = [];
      const walked = await walkKeyset({
        service,
        sql: statement,
        parameters,
        timeWindow,
        limit,
        onPage: (page) => {
          columns = page.columns;
          const rows =
            limit === undefined ? page.rows : page.rows.slice(0, limit);
          chunks.push(
            renderRows({
              format: format === "table" ? "jsonl" : format,
              columns: page.columns,
              rows,
            }),
          );
        },
      });
      spinner.succeed(
        `Read ${walked.rows} row${walked.rows !== 1 ? "s" : ""} over ${walked.pages} page${walked.pages !== 1 ? "s" : ""}`,
      );
      return writeOrPrint({
        body: chunks.join("\n"),
        output: options.output,
        columns,
      });
    }

    const result = await service.query({
      sql: statement,
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    });
    const rows = limit === undefined ? result.rows : result.rows.slice(0, limit);

    spinner.succeed(
      `${rows.length} row${rows.length !== 1 ? "s" : ""} in ${result.statistics.elapsedMs}ms`,
    );

    if (format !== "table" || options.output !== undefined) {
      return writeOrPrint({
        body: renderRows({
          format: format === "table" ? "json" : format,
          columns: result.columns,
          rows,
        }),
        output: options.output,
        columns: result.columns,
      });
    }

    return {
      data: { ...result, rows },
      table: () => printTable({ ...result, rows }),
    };
  } catch (error) {
    failSpinner({ spinner, error, action: "run statement" });
    process.exit(1);
  }
};

/**
 * Writes the rendered body, or prints it.
 *
 * Returns nothing rather than a `CommandResult`: the body is already the bytes
 * the caller asked for, and handing it to the output port would re-serialise
 * a document that is deliberately not JSON.
 */
function writeOrPrint({
  body,
  output,
  columns,
}: {
  body: string;
  output?: string;
  columns: readonly QueryColumn[];
}): void {
  if (output === undefined) {
    process.stdout.write(body.endsWith("\n") || body === "" ? body : `${body}\n`);
    return;
  }
  writeFileSync(output, body.endsWith("\n") ? body : `${body}\n`);
  console.log(
    chalk.green(
      `Written to ${output} (${columns.length} column${columns.length !== 1 ? "s" : ""})`,
    ),
  );
}
