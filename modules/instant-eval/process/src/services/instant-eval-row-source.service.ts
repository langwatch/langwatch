/**
 * The reads a run performs, each a wrapper around the caller's own statement,
 * run through Analytics as the project's restricted identity. A result cut
 * short is an error here, never a shorter answer.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import type {
  LangWatchQLCaller,
  LangWatchQLColumn,
  LangWatchQLExecuteInput,
  LangWatchQLProtections,
  LangWatchQLQueryResult,
} from "@langwatch/analytics-contract";
import { Temporal } from "@langwatch/time";

import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
  INSTANT_EVAL_TRACE_COLUMN,
  instantEvalCountSql,
  instantEvalKeyPassSql,
  instantEvalPagesBySpan,
  instantEvalProbeSql,
  instantEvalSampleBuckets,
  instantEvalSampleKeysSql,
} from "../rules/instant-eval-composition.rules.ts";
import {
  instantEvalRowText,
  type InstantEvalCursor,
  type InstantEvalKeyPage,
  type InstantEvalRowKey,
} from "../rules/instant-eval-row-keys.rules.ts";

/**
 * Raised when a read came back cut short by the executor's result ceiling:
 * every read here is one whose length is part of the answer.
 */
export class InstantEvalResultTruncatedError extends Error {
  constructor(pass: string) {
    super(
      `the instant eval ${pass} pass came back truncated; narrow the statement or lower the page size`,
    );
    this.name = "InstantEvalResultTruncatedError";
  }
}

/** The Analytics peer, narrowed to the one operation every pass runs. */
export interface InstantEvalStatementRunner {
  executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
}

/** What one pass reads about its selection, whoever asked for it. */
interface InstantEvalPassInput {
  readonly caller: LangWatchQLCaller;
  readonly protections: LangWatchQLProtections;
  readonly sql: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
}

/**
 * Epoch milliseconds a time column's text carries, or `NaN` when it carries no
 * instant. ClickHouse renders a DateTime without a zone, which is UTC.
 */
function epochMillisecondsOf(text: string): number {
  const zoned = /[Z+-]\d{0,2}:?\d{0,2}$/.test(text.slice(10)) ? text : `${text}Z`;
  try {
    return Temporal.Instant.from(zoned).epochMilliseconds;
  } catch {
    return Number.NaN;
  }
}

function toRowKey(row: Record<string, unknown>): InstantEvalRowKey {
  const key = {
    traceId: instantEvalRowText(row, INSTANT_EVAL_TRACE_COLUMN),
    threadId: instantEvalRowText(row, "ThreadId"),
    spanId: instantEvalRowText(row, "SpanId"),
  };
  const at = row.OccurredAt;
  if (typeof at === "number") return { ...key, occurredAt: at };
  const text = instantEvalRowText(row, "OccurredAt");
  if (text === "") return { ...key, occurredAt: null };
  const millis = epochMillisecondsOf(text);

  return { ...key, occurredAt: Number.isNaN(millis) ? null : millis };
}

export class InstantEvalRowSourceService {
  private constructor(private readonly analytics: InstantEvalStatementRunner) {}

  static create({
    analytics,
  }: {
    analytics: InstantEvalStatementRunner;
  }): InstantEvalRowSourceService {
    return new InstantEvalRowSourceService(analytics);
  }

  /** What the statement projects, without reading a row or judging anything. */
  async probe(input: InstantEvalPassInput): Promise<readonly LangWatchQLColumn[]> {
    const execution = await this.#run({
      ...input,
      sql: instantEvalProbeSql(input.sql),
      maxRows: 1,
    });

    return execution.columns;
  }

  /**
   * How many rows the statement matches, counted at most `limit`. Separate
   * from {@link keys}: reading a hundred thousand keys to learn a run's total
   * is past the executor's own result ceiling.
   */
  async count(input: InstantEvalPassInput & { limit: number }): Promise<number> {
    const execution = await this.#run({
      ...input,
      sql: instantEvalCountSql({ sql: input.sql, limit: input.limit }),
      maxRows: 1,
      pass: "count",
    });
    const total = execution.rows[0]?.total;
    if (typeof total === "number") return total;
    // ClickHouse renders a UInt64 as a decimal string in JSON, which is what a
    // count comes back as on every path that matters here.
    const parsed = typeof total === "string" ? Number.parseInt(total, 10) : Number.NaN;

    return Number.isFinite(parsed) ? parsed : 0;
  }

  /** One page of row keys, after the key the previous page ended on. */
  async keys(
    input: InstantEvalPassInput & {
      /** The optional key columns the statement projects, from {@link probe}. */
      keyColumns: readonly string[];
      limit: number;
      after?: InstantEvalCursor;
    },
  ): Promise<InstantEvalKeyPage> {
    // One row past the page, which is how "there is more" is learned without a
    // second count over the same statement.
    const probeLimit = input.limit + 1;
    const bySpan = instantEvalPagesBySpan(input.keyColumns);
    const execution = await this.#run({
      ...input,
      sql: instantEvalKeyPassSql({
        sql: input.sql,
        keyColumns: input.keyColumns,
        limit: probeLimit,
        hasCursor: input.after !== undefined,
      }),
      parameters: {
        ...input.parameters,
        ...(input.after === undefined
          ? {}
          : {
              [INSTANT_EVAL_AFTER_PARAMETER]: input.after.traceId,
              ...(bySpan ? { [INSTANT_EVAL_AFTER_SPAN_PARAMETER]: input.after.spanId ?? "" } : {}),
            }),
      },
      maxRows: probeLimit,
      pass: "key",
    });

    return {
      keys: execution.rows.slice(0, input.limit).map(toRowKey),
      hasMore: execution.rows.length > input.limit,
    };
  }

  /**
   * A sample of the selection's keys, spread across the whole of it: the first
   * fifty keys of a statement ordered by conversation id are the fifty lowest
   * ids, and measuring those sizes and prices the wrong rows.
   */
  async sampleKeys(
    input: InstantEvalPassInput & {
      keyColumns: readonly string[];
      limit: number;
      /** Rows the statement matches, which sets how wide the spread has to be. */
      total: number;
    },
  ): Promise<readonly InstantEvalRowKey[]> {
    const execution = await this.#run({
      ...input,
      sql: instantEvalSampleKeysSql({
        sql: input.sql,
        keyColumns: input.keyColumns,
        limit: input.limit,
      }),
      parameters: {
        ...input.parameters,
        [INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER]: instantEvalSampleBuckets({
          total: input.total,
          limit: input.limit,
        }),
      },
      maxRows: input.limit,
    });

    return execution.rows.map(toRowKey);
  }

  /**
   * Runs one pass as the caller and refuses a result that outgrew its bound.
   * `pass` names the read in the refusal; a pass that cannot outgrow its own
   * SQL bound passes none.
   */
  async #run({
    caller,
    protections,
    sql,
    parameters,
    maxRows,
    pass,
  }: InstantEvalPassInput & {
    maxRows: number;
    pass?: string;
  }): Promise<LangWatchQLQueryResult> {
    const execution = await this.analytics.executeLangWatchQL({
      project: caller,
      protections,
      sql,
      ...(parameters && Object.keys(parameters).length > 0 ? { parameters } : {}),
    });
    const isTruncated = execution.rows.length > maxRows;
    if (isTruncated && pass !== undefined) throw new InstantEvalResultTruncatedError(pass);

    return execution;
  }
}
