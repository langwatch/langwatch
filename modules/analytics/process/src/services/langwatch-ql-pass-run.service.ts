/**
 * Runs one Instant Evals pass: the queries it sends, in order, and the trace-ids twin each may
 * read instead of its view, with the statement as written while a twin is not readable yet
 * (analytics ADR-006, amendment 2026-11-24). @see specs/lwql/dedup-trace-ids.feature
 */
import {
  LangWatchQLProvisioningIncompleteError,
  LangWatchQLUnavailableError,
  type LangWatchQLPass,
  type LangWatchQLQueryResult,
  type LangWatchQLStatistics,
} from "@langwatch/analytics-contract";
import { createLogger } from "@langwatch/observability";

import type {
  LangWatchQLExecutionResult,
  LangWatchQLExecutorRepository,
} from "../repositories/langwatch-ql-executor.repository.ts";
import {
  declaresPassTraceIdsParameter,
  langWatchQLPassKeysOfTracesSql,
  langWatchQLPassRowIdColumns,
  langWatchQLPassRowIdsSql,
  langWatchQLPassSql,
  LWQL_HYDRATION_TRACE_IDS_ARGUMENT,
  LWQL_PASS_TRACE_IDS_ARGUMENT,
  readsKeysByTraceIds,
  type LangWatchQLComposedPass,
} from "../rules/langwatch-ql-pass-sql.rules.ts";
import {
  LWQL_TRACE_ID_COLUMN,
  refusalNamesTwin,
  restrictLangWatchQLToTraceIds,
} from "../rules/lwql-dedup-trace-ids.rules.ts";
import type { LangWatchQLViewDefinition } from "./langwatch-ql-catalog-shapes.service.ts";

const logger = createLogger("langwatch:analytics:lwql");

/** How many times a two-step page whose steps disagree is read again before one read answers it. */
const TWO_STEP_ATTEMPTS = 2;

/** What one query of a pass answers: at least its rows. */
interface LangWatchQLPassQueryResult {
  readonly rows: readonly object[];
}

/** Sends one query of a pass and answers it; a refusal is thrown. */
type LangWatchQLPassQuery<Result> = (query: LangWatchQLComposedPass) => Promise<Result>;

/**
 * Whether a refusal says the twin itself is missing or not granted yet, by the relation it
 * names ({@link refusalNamesTwin}), so a missing relation the statement reads elsewhere refuses
 * the pass as it would have without the twin.
 */
function isTwinNotReady({ error, twin }: { error: unknown; twin: string }): boolean {
  const isDeploymentGap =
    error instanceof LangWatchQLUnavailableError ||
    error instanceof LangWatchQLProvisioningIncompleteError;
  if (!isDeploymentGap) return false;
  return error.reasons.some((reason) => refusalNamesTwin({ message: reason.message, twin }));
}

/** A row's value in `column`, read without assuming its shape. */
function valueOf({ row, column }: { row: object; column: string }): unknown {
  return new Map(Object.entries(row)).get(column);
}

/** The distinct trace ids of a page's row ids, in the order they came. */
function traceIdsOf(rows: readonly object[]): string[] {
  const ids = rows.map((row) => String(valueOf({ row, column: LWQL_TRACE_ID_COLUMN })));
  return [...new Set(ids)];
}

/** Whether two reads answered the same row ids, in the same order. */
function sameRowIds({
  columns,
  picked,
  read,
}: {
  columns: readonly string[];
  picked: readonly object[];
  read: readonly object[];
}): boolean {
  const ids = (rows: readonly object[]) =>
    rows.map((row) => JSON.stringify(columns.map((column) => valueOf({ row, column }))));
  return JSON.stringify(ids(picked)) === JSON.stringify(ids(read));
}

/** One pass of an accepted statement, as however many queries it takes. */
export class LangWatchQLPassRunService {
  static create(): LangWatchQLPassRunService {
    return new LangWatchQLPassRunService();
  }

  private constructor() {}

  /**
   * Runs `pass` on `executor` as the caller's restricted identity, beside the caller's values.
   * Its statistics add up every query the pass sent; the rows returned are the last query's.
   */
  async runAs({
    executor,
    bound,
    tenantCapability,
    projectIds,
    ...statement
  }: {
    executor: LangWatchQLExecutorRepository;
    sql: string;
    pass: LangWatchQLPass;
    database: string;
    views: readonly LangWatchQLViewDefinition[];
    /** The caller's own parameter values; a wrapper's value of the same name wins. */
    bound?: Readonly<Record<string, unknown>>;
    tenantCapability: string;
    projectIds: readonly string[];
  }): Promise<LangWatchQLQueryResult> {
    const sent: LangWatchQLStatistics[] = [];
    const execution = await this.run({
      ...statement,
      query: async (composed): Promise<LangWatchQLExecutionResult> => {
        const parameters = { ...bound, ...composed.parameters };
        const bindings = Object.keys(parameters).length > 0 ? { parameters } : {};
        const result = await executor.execute({
          sql: composed.sql,
          ...bindings,
          tenantCapability,
          projectIds,
        });
        sent.push(result.statistics);
        return result;
      },
    });
    const total = (field: "elapsedMs" | "rowsRead" | "bytesRead") =>
      sent.reduce((sum, statistics) => sum + statistics[field], 0);
    return {
      columns: execution.columns,
      rows: execution.rows,
      statistics: {
        ...execution.statistics,
        elapsedMs: total("elapsedMs"),
        rowsRead: total("rowsRead"),
        bytesRead: total("bytesRead"),
      },
      diagnostics: [],
      followsTimeWindow: false,
      followsGranularity: false,
    };
  }

  /**
   * Answers `pass` over `sql` through `query`. A key or sample pass that projects more than the
   * ids sends two: the page's row ids, then its keys over the twin cut by those traces; a page
   * pass reads the twin cut by its own traces. Every other pass, or shape, is one query as before.
   */
  async run<Result extends LangWatchQLPassQueryResult>({
    sql,
    pass,
    database,
    views,
    query,
  }: {
    sql: string;
    pass: LangWatchQLPass;
    /** Where unqualified view names resolve. */
    database: string;
    views: readonly LangWatchQLViewDefinition[];
    query: LangWatchQLPassQuery<Result>;
  }): Promise<Result> {
    const restrict = (traceIds: string) =>
      restrictLangWatchQLToTraceIds({ sql, database, views, traceIds });
    if (pass.kind === "page") {
      const cut = restrict(LWQL_HYDRATION_TRACE_IDS_ARGUMENT);
      return this.#readTwin({
        twin: cut.twin,
        cut: langWatchQLPassSql({ sql: cut.sql, pass }),
        asWritten: langWatchQLPassSql({ sql, pass }),
        query,
      });
    }
    const cut = restrict(LWQL_PASS_TRACE_IDS_ARGUMENT);
    const single = langWatchQLPassSql({ sql, pass });
    if (
      !readsKeysByTraceIds(pass) ||
      cut.twin === undefined ||
      declaresPassTraceIdsParameter(sql)
    ) {
      return query(single);
    }
    const { twin } = cut;
    const columns = langWatchQLPassRowIdColumns(pass);
    // Each step reads its own `now()`: a moving window can drop a picked row before step two.
    for (let attempt = 0; attempt < TWO_STEP_ATTEMPTS; attempt++) {
      const picked = (await query(langWatchQLPassRowIdsSql({ sql, pass }))).rows;
      const traceIds = traceIdsOf(picked);
      const keys = await this.#readTwin({
        twin,
        cut: langWatchQLPassKeysOfTracesSql({ sql: cut.sql, pass, traceIds }),
        asWritten: langWatchQLPassKeysOfTracesSql({ sql, pass, traceIds }),
        query,
      });
      if (sameRowIds({ columns, picked, read: keys.rows })) return keys;
    }
    logger.warn({ kind: pass.kind }, "LangWatchQL pass steps kept disagreeing; read as one query");
    return query(single);
  }

  /** Reads `cut`, or `asWritten` when the statement reads no twin or the twin is not readable. */
  async #readTwin<Result>({
    twin,
    cut,
    asWritten,
    query,
  }: {
    twin: string | undefined;
    cut: LangWatchQLComposedPass;
    asWritten: LangWatchQLComposedPass;
    query: LangWatchQLPassQuery<Result>;
  }): Promise<Result> {
    if (twin === undefined) return query(asWritten);
    return query(cut).catch((error: unknown) => {
      if (!isTwinNotReady({ error, twin })) throw error;
      logger.warn(
        { twin },
        "LangWatchQL trace-ids view not readable yet; sent the pass as written",
      );
      return query(asWritten);
    });
  }
}
