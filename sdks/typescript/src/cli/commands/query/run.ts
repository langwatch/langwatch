/**
 * `langwatch query "<sql>"` — one statement, run as written. `--page-by keyset`
 * rebinds the statement's own cursor parameters, never its text.
 * @see specs/analytics/lwql-cli-query.feature
 */

import { writeFileSync } from "node:fs";

import chalk from "chalk";

import {
  type QueryRunResult,
  QueryApiService,
} from "@/client-sdk/services/query/query-api.service";

import { resolveCredentials } from "../../utils/apiKey";
import type { CommandResult } from "../../utils/output";
import { createSpinner } from "../../utils/spinner";
import { failSpinner } from "../../utils/spinnerError";
import { type QueryColumn, type QueryOutputFormat, type QueryRow, renderRows } from "./rows";
import {
  type ParameterValue,
  printTable,
  refuse,
  resolveFormat,
  resolveLimit,
  resolveParameters,
  resolveStatement,
  resolveTimeWindow,
} from "./run-options";

/**
 * The cursor parameters `--page-by keyset` rebinds, a convention the server
 * does not enforce — which is why a statement declaring neither is refused
 * rather than run as page one over and over.
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

export interface QueryRunOptions {
  sqlFile?: string;
  start?: string;
  end?: string;
  param?: string[];
  limit?: string;
  format?: string;
  pageBy?: string;
  out?: string;
  project?: string;
}

/** Where the next page of a keyset walk starts. */
interface KeysetCursor {
  after_ts: string;
  after_id: string;
}

function cursorFrom(rows: readonly QueryRow[]): KeysetCursor | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const timestamp = last[AFTER_TIMESTAMP_PARAMETER];
  const id = last[AFTER_ID_PARAMETER];
  if (typeof timestamp !== "string" || typeof id !== "string") return null;
  return { after_ts: timestamp, after_id: id };
}

/** What a keyset statement has to project for the walk to read its cursor. */
function requireCursorColumns(columns: readonly QueryColumn[]): void {
  const projected = new Set(columns.map((column) => column.name));
  const missing = [AFTER_TIMESTAMP_PARAMETER, AFTER_ID_PARAMETER].filter(
    (name) => !projected.has(name),
  );
  if (missing.length === 0) return;
  refuse(
    `--page-by keyset reads the next page's cursor from the columns ${AFTER_TIMESTAMP_PARAMETER} and ${AFTER_ID_PARAMETER}, and this statement projects neither${missing.length === 1 ? ` ${missing[0]}` : ""}. Alias the two columns you order by, for example \`SELECT StartedAt AS ${AFTER_TIMESTAMP_PARAMETER}, TraceId AS ${AFTER_ID_PARAMETER}\`. See \`langwatch query examples --tag paging\`.`,
  );
}

/**
 * Where the page after this one starts, or nothing: a short page is the last
 * one, the row budget is spent, or the cursor did not move and another page
 * would repeat this one.
 */
function nextCursorAfter({
  page,
  cursor,
  previousPageSize,
  rows,
  limit,
}: {
  page: QueryRunResult;
  cursor: KeysetCursor;
  previousPageSize: number | null;
  rows: number;
  limit?: number;
}): KeysetCursor | null {
  if (previousPageSize !== null && page.rows.length < previousPageSize) return null;
  if (limit !== undefined && rows >= limit) return null;

  const next = cursorFrom(page.rows);
  if (!next) return null;

  return next.after_ts === cursor.after_ts && next.after_id === cursor.after_id ? null : next;
}

/**
 * Every page of a keyset statement, the cursor rebound from the row the last
 * page ended on. Stops on a short page, on a cursor that did not move, and on
 * the row budget `--limit` set.
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
  onPage: (page: QueryRunResult, rows: readonly QueryRow[]) => void;
}): Promise<{ pages: number; rows: number }> {
  if (!sql.includes(AFTER_TIMESTAMP_PARAMETER) || !sql.includes(AFTER_ID_PARAMETER)) {
    refuse(
      `--page-by keyset needs the statement to declare {${AFTER_TIMESTAMP_PARAMETER}:DateTime64(3)} and {${AFTER_ID_PARAMETER}:String} in its WHERE and to ORDER BY the same two columns. See \`langwatch query examples --tag paging\`.`,
    );
  }

  let cursor: KeysetCursor = { ...KEYSET_START };
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
    if (pages === 1) requireCursorColumns(page.columns);

    // `--limit` is a budget for the whole walk, not for each page: slicing to
    // the flag on every page would write it once per page.
    const remaining = limit === undefined ? page.rows.length : limit - rows;
    onPage(page, page.rows.slice(0, remaining));
    rows += Math.min(page.rows.length, remaining);

    const next = nextCursorAfter({ page, cursor, previousPageSize, rows, limit });
    previousPageSize = page.rows.length;
    if (!next) break;
    cursor = next;
  }

  return { pages, rows };
}

async function runKeysetWalk({
  service,
  statement,
  parameters,
  timeWindow,
  limit,
  format,
  output,
}: {
  service: QueryApiService;
  statement: string;
  parameters: Record<string, ParameterValue>;
  timeWindow?: { start: string; end: string };
  limit?: number;
  format: QueryOutputFormat;
  output?: string;
}): Promise<void> {
  const spinner = createSpinner("Running statement...").start();
  const chunks: string[] = [];
  let columns: readonly QueryColumn[] = [];
  try {
    const walked = await walkKeyset({
      service,
      sql: statement,
      parameters,
      timeWindow,
      limit,
      onPage: (page, rows) => {
        columns = page.columns;
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
  } catch (error) {
    failSpinner({ spinner, error, action: "run statement" });
    process.exit(1);
  }
  writeOrPrint({ body: chunks.join("\n"), output, columns });
}

async function runSinglePage({
  service,
  statement,
  parameters,
  timeWindow,
  limit,
  format,
  output,
}: {
  service: QueryApiService;
  statement: string;
  parameters: Record<string, ParameterValue>;
  timeWindow?: { start: string; end: string };
  limit?: number;
  format: QueryOutputFormat;
  output?: string;
}): Promise<CommandResult | void> {
  const spinner = createSpinner("Running statement...").start();
  let result: QueryRunResult;
  try {
    result = await service.query({
      sql: statement,
      ...(Object.keys(parameters).length > 0 ? { parameters } : {}),
      ...(timeWindow ? { timeWindow } : {}),
    });
  } catch (error) {
    failSpinner({ spinner, error, action: "run statement" });
    process.exit(1);
  }

  const rows = limit === undefined ? result.rows : result.rows.slice(0, limit);
  spinner.succeed(
    `${rows.length} row${rows.length !== 1 ? "s" : ""} in ${result.statistics.elapsedMs}ms`,
  );

  if (format !== "table" || output !== undefined) {
    return writeOrPrint({
      body: renderRows({
        format: format === "table" ? "json" : format,
        columns: result.columns,
        rows,
      }),
      output,
      columns: result.columns,
    });
  }

  // `data` is the rows array, not the whole result: `langwatch query "<sql>"
  // -o json` must print exactly one JSON array of rows, which is also what
  // `--format json` renders. The statistics and diagnostics reach a reader
  // through the table and the spinner line, not through the machine payload.
  return {
    data: rows,
    table: () => printTable({ ...result, rows }),
  };
}

export const runQueryCommand = async (
  sql: string | undefined,
  options: QueryRunOptions = {},
): Promise<CommandResult | void> => {
  // Flags first, credentials second. A typo in --format is the caller's to fix
  // either way, and reading the credential first turns it into whatever the
  // credential lookup happens to say — "no API key found" for a command that
  // was never going to run.
  const pageByKeyset = options.pageBy === "keyset";
  if (options.pageBy !== undefined && !pageByKeyset) {
    refuse("--page-by only understands `keyset`");
  }
  const limit = resolveLimit(options.limit);
  const timeWindow = resolveTimeWindow(options);
  const resolved = {
    statement: resolveStatement({ sql, sqlFile: options.sqlFile }),
    parameters: resolveParameters(options.param),
    format: resolveFormat(options.format),
    ...(limit === undefined ? {} : { limit }),
    ...(timeWindow ? { timeWindow } : {}),
    ...(options.out === undefined ? {} : { output: options.out }),
  };

  await resolveCredentials({ project: options.project });
  const common = { ...resolved, service: new QueryApiService() };

  return pageByKeyset ? runKeysetWalk(common) : runSinglePage(common);
};

/**
 * Writes the rendered body, or prints it. Not a `CommandResult`: the body is
 * already the bytes asked for, and the output port would re-serialise a
 * document that is deliberately not JSON.
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
  // On stderr: with `--out` the whole point is that stdout stays empty, so
  // a shell redirect of the command's output carries the rows and nothing else.
  process.stderr.write(
    `${chalk.green(
      `Written to ${output} (${columns.length} column${columns.length !== 1 ? "s" : ""})`,
    )}\n`,
  );
}
