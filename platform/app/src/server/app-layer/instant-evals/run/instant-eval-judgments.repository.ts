/**
 * Where a run's judgements are kept, and how they are read back.
 *
 * Writes are insert-only into a ReplacingMergeTree keyed by
 * `(TenantId, RunId, TraceId, SpanId, QuestionId)`, which is what makes a
 * redelivered page safe: the same page judged twice re-inserts the same keys
 * with the same values, and the merge collapses them. The page intent writes
 * here BEFORE it records the page as judged, so a crash between the two costs
 * a redelivery rather than a lost page.
 *
 * Reads are keyset-paged on `(TraceId, SpanId, QuestionId)`, which is the sort
 * key's own order after the run, so a page is a range scan rather than an
 * offset. The cursor is opaque to a caller and carries all three parts,
 * because one trace has a row per span per question and a cursor on fewer of
 * them would skip or repeat.
 *
 * Every query filters `TenantId` first and bounds `CreatedAt`, which the run's
 * own timestamps supply. Without the time bound a read by run id walks every
 * partition, including the cold ones.
 *
 * @see ./instant-eval-judgments.query.ts: the cursor, the filters and the row
 * @see ../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 * @see ../../../../../specs/instant-evals/instant-eval-api.feature
 */

import { createLogger } from "@langwatch/observability";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import {
  buildFilters,
  encodeInstantEvalCursor,
  type JudgmentRow,
  toJudgment,
} from "./instant-eval-judgments.query";
import type {
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentStatus,
} from "./judgments";

const TABLE_NAME = "instant_eval_judgments" as const;

const logger = createLogger("langwatch:instant-evals:judgments-repository");

/** One judgement as a caller reads it. */
export interface InstantEvalJudgment {
  readonly traceId: string;
  readonly questionId: string;
  readonly threadId: string;
  readonly spanId: string;
  readonly kind: string;
  readonly status: InstantEvalJudgmentStatus;
  readonly passed: boolean | null;
  readonly score: number | null;
  readonly label: string | null;
  readonly probability: number | null;
  /** The full distribution of a category answer, parsed back from its JSON. */
  readonly probabilities: Readonly<Record<string, number>> | null;
  readonly error: string | null;
  readonly occurredAt: string;
}

/** One page of judgements, and where the next one starts. */
export interface InstantEvalJudgmentPage {
  readonly judgments: readonly InstantEvalJudgment[];
  /** Absent on the last page. */
  readonly nextCursor?: string;
}

export interface InstantEvalJudgmentQuery {
  readonly projectId: string;
  readonly runId: string;
  /** The window the run's judgements were written in. */
  readonly writtenFrom: Date;
  readonly writtenUntil: Date;
  readonly limit: number;
  /** Only this question's judgements. */
  readonly questionId?: string;
  /** Only judgements that matched, or only those that did not. */
  readonly matched?: boolean;
  readonly status?: InstantEvalJudgmentStatus;
  /** The cursor a previous page returned. */
  readonly cursor?: string;
  /** Only these traces, which is how a sample reads its own rows. */
  readonly traceIds?: readonly string[];
}

/** What a sample asks for, which is a few whole traces rather than a page. */
export interface InstantEvalJudgmentSampleQuery {
  readonly projectId: string;
  readonly runId: string;
  readonly writtenFrom: Date;
  readonly writtenUntil: Date;
  /** Traces to pick. Every judgement of a picked trace comes back. */
  readonly traces: number;
  /**
   * Put traces with a boolean match first.
   *
   * What a caller checks with a sample is whether the run answered the
   * question they meant to ask, and the rows that carry that answer are the
   * ones that matched. A run with no boolean question has none to prefer.
   */
  readonly shouldPreferMatched: boolean;
  /** Varies which traces a repeated call picks. */
  readonly seed: number;
}

export interface InstantEvalJudgmentsRepository {
  insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void>;
  page(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage>;
  /**
   * A few whole traces of a run, chosen pseudo-randomly.
   *
   * Not the first page of {@link page}: that is ordered by the sort key, so
   * every call would return the same lowest trace ids and a sample would only
   * ever show one corner of the run.
   */
  sample(
    query: InstantEvalJudgmentSampleQuery,
  ): Promise<readonly InstantEvalJudgment[]>;
}

export class ClickHouseInstantEvalJudgmentsRepository
  implements InstantEvalJudgmentsRepository
{
  constructor(private readonly resolveClient: ClickHouseClientResolver) {}

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    const [first] = records;
    if (!first) return;

    // One tenant per call, and checked rather than trusted: this one value
    // chooses which ClickHouse the whole batch is written to, so a batch that
    // ever mixed tenants would land one project's judgements in another's. A
    // plain Error on purpose, since it is a broken internal invariant.
    const tenantId = first.TenantId;
    const foreign = records.find((record) => record.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `instant_eval_judgments batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: records.map((record) => ({
        ...record,
        OccurredAt: new Date(record.OccurredAt),
        CreatedAt: new Date(record.CreatedAt),
        UpdatedAt: new Date(record.UpdatedAt),
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
    logger.debug(
      { tenantId, runId: first.RunId, count: records.length },
      "Instant Eval judgements written",
    );
  }

  async page(
    query: InstantEvalJudgmentQuery,
  ): Promise<InstantEvalJudgmentPage> {
    const { where, having, parameters } = buildFilters(query);
    const client = await this.resolveClient(query.projectId);
    // One row past the page, so "there is more" needs no second query.
    const limit = query.limit + 1;

    const result = await client.query({
      // argMax over the version column rather than FINAL: the dedup is
      // eventual, and a page has to be the latest version of each verdict
      // without materialising every column of every granule.
      query: `
        SELECT
          TraceId,
          SpanId,
          QuestionId,
          argMax(ThreadId, UpdatedAt) AS ThreadId,
          argMax(Kind, UpdatedAt) AS Kind,
          argMax(Status, UpdatedAt) AS Status,
          argMax(Passed, UpdatedAt) AS Passed,
          argMax(Score, UpdatedAt) AS Score,
          argMax(Label, UpdatedAt) AS Label,
          argMax(Probability, UpdatedAt) AS Probability,
          argMax(Probabilities, UpdatedAt) AS Probabilities,
          argMax(Error, UpdatedAt) AS Error,
          argMax(OccurredAt, UpdatedAt) AS OccurredAt
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND RunId = {runId:String}
          AND CreatedAt >= {writtenFrom:DateTime64(3)}
          AND CreatedAt <= {writtenUntil:DateTime64(3)}
          ${where.map((condition) => `AND ${condition}`).join("\n          ")}
        GROUP BY TraceId, SpanId, QuestionId
        ${having.length > 0 ? `HAVING ${having.join(" AND ")}` : ""}
        ORDER BY TraceId, SpanId, QuestionId
        LIMIT {limit:UInt32}
      `,
      query_params: {
        ...parameters,
        tenantId: query.projectId,
        runId: query.runId,
        writtenFrom: query.writtenFrom,
        writtenUntil: query.writtenUntil,
        limit,
      },
      format: "JSON",
    });

    const rows = (await result.json<JudgmentRow>()).data;
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      judgments: page.map(toJudgment),
      ...(rows.length > query.limit && last
        ? { nextCursor: encodeInstantEvalCursor(toJudgment(last)) }
        : {}),
    };
  }

  async sample(
    query: InstantEvalJudgmentSampleQuery,
  ): Promise<readonly InstantEvalJudgment[]> {
    const client = await this.resolveClient(query.projectId);
    const bounds = `
      WHERE TenantId = {tenantId:String}
        AND RunId = {runId:String}
        AND CreatedAt >= {writtenFrom:DateTime64(3)}
        AND CreatedAt <= {writtenUntil:DateTime64(3)}
    `;
    // The hash of the trace and the seed is the ordering: deterministic for a
    // given seed, so paging the same sample twice agrees, and different for
    // the next call, so the caller is not shown the same corner of the run
    // over and over.
    const order = query.shouldPreferMatched
      ? "max(Passed) DESC, cityHash64(TraceId, {seed:UInt64})"
      : "cityHash64(TraceId, {seed:UInt64})";

    const result = await client.query({
      query: `
        SELECT
          TraceId,
          SpanId,
          QuestionId,
          argMax(ThreadId, UpdatedAt) AS ThreadId,
          argMax(Kind, UpdatedAt) AS Kind,
          argMax(Status, UpdatedAt) AS Status,
          argMax(Passed, UpdatedAt) AS Passed,
          argMax(Score, UpdatedAt) AS Score,
          argMax(Label, UpdatedAt) AS Label,
          argMax(Probability, UpdatedAt) AS Probability,
          argMax(Probabilities, UpdatedAt) AS Probabilities,
          argMax(Error, UpdatedAt) AS Error,
          argMax(OccurredAt, UpdatedAt) AS OccurredAt
        FROM ${TABLE_NAME}
        ${bounds}
          AND TraceId IN (
            SELECT TraceId
            FROM ${TABLE_NAME}
            ${bounds}
            GROUP BY TraceId
            ORDER BY ${order}
            LIMIT {traces:UInt32}
          )
        GROUP BY TraceId, SpanId, QuestionId
        ORDER BY TraceId, SpanId, QuestionId
      `,
      query_params: {
        tenantId: query.projectId,
        runId: query.runId,
        writtenFrom: query.writtenFrom,
        writtenUntil: query.writtenUntil,
        traces: query.traces,
        seed: query.seed,
      },
      format: "JSON",
    });

    return (await result.json<JudgmentRow>()).data.map(toJudgment);
  }
}
