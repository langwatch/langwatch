import { INSTANT_EVAL_RESULTS_CEILING } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  EvalResultRecord,
  EvalResultsRecallQuery,
  EvalResultsRepository,
  EvalResultsTraceQuery,
  EvalTraceResult,
  RecalledEvalResult,
} from "../eval-results.repository.ts";
import {
  evalResultsInsertBatches,
  evalResultsRecallParameters,
  evalResultsTraceParameters,
  evalTraceResultRowSchema,
  type RecalledEvalResultRow,
  toEvalResultValues,
  toEvalTraceResult,
  toRecalledEvalResult,
} from "./clickhouse.eval-results.mapper.ts";
import type { InstantEvalClickHouseResolver } from "./clickhouse.instant-eval-session.store.ts";

const TABLE_NAME = "eval_results" as const;

const totalRowsSchema = z.array(z.object({ Total: z.string() }));
const traceRowsSchema = z.array(evalTraceResultRowSchema);

const logger = createLogger("langwatch:instant-evals:eval-results-repository");

/**
 * The latest judged row per key, read as one tuple: an aggregate over a Nullable column skips
 * its NULLs, so a separate argMax per column could mix two rows into one verdict. The inner read
 * carries the tenant and the trace-time window; the key columns lead the sort key.
 */
const RECALL_QUERY = `
  SELECT
    TraceId,
    SpanId,
    QuestionHash,
    InputHash,
    Latest.1 AS LatestSourceId,
    Latest.2 AS Score,
    Latest.3 AS Label,
    Latest.4 AS Probability,
    Latest.5 AS Probabilities,
    toUnixTimestamp64Milli(Latest.6) AS LatestJudgedAt,
    toUnixTimestamp64Milli(Latest.7) AS LatestUpdatedAt
  FROM (
    SELECT
      TraceId,
      SpanId,
      QuestionHash,
      InputHash,
      argMax(
        (SourceId, Score, Label, Probability, Probabilities, JudgedAt, UpdatedAt),
        (JudgedAt, UpdatedAt, SourceId)
      ) AS Latest
    FROM ${TABLE_NAME}
    WHERE TenantId = {tenantId:String}
      AND OccurredAt >= {occurredFrom:DateTime64(3)}
      AND OccurredAt <= {occurredUntil:DateTime64(3)}
      AND TraceId IN ({traceIds:Array(String)})
      AND SpanId IN ({spanIds:Array(String)})
      AND QuestionHash IN ({questionHashes:Array(String)})
      AND JudgeModel = {judgeModel:String}
      AND InputHash IN ({inputHashes:Array(String)})
      AND KeyVersion = {keyVersion:UInt16}
      AND Status = {status:String}
    GROUP BY TraceId, SpanId, QuestionHash, InputHash
  )`;

/**
 * The drawer's read: per span, question and judged column, the row a judged one wins over any
 * failed or skipped one, then the latest, read as one tuple as recall is. A prefix read of the
 * sort key; a monitor's rows are left out, as the trace shows them from evaluation_runs.
 */
const TRACE_QUERY = `
  SELECT
    SpanId,
    QuestionHash,
    JudgedColumn,
    Latest.1 AS LatestQuestion,
    Latest.2 AS LatestKind,
    Latest.3 AS LatestStatus,
    Latest.4 AS LatestProbability,
    Latest.5 AS LatestScore,
    Latest.6 AS LatestLabel,
    Latest.7 AS LatestJudgeModel,
    Latest.8 AS LatestSource,
    Latest.9 AS LatestSourceId,
    toUnixTimestamp64Milli(Latest.10) AS LatestJudgedAt,
    toUnixTimestamp64Milli(Latest.11) AS LatestUpdatedAt
  FROM (
    SELECT
      SpanId,
      QuestionHash,
      JudgedColumn,
      argMax(
        (Question, Kind, Status, Probability, Score, Label, JudgeModel, Source, SourceId, JudgedAt, UpdatedAt),
        (Status = {judged:String}, JudgedAt, UpdatedAt, SourceId)
      ) AS Latest
    FROM ${TABLE_NAME}
    WHERE TenantId = {tenantId:String}
      AND OccurredAt >= {occurredFrom:DateTime64(3)}
      AND OccurredAt <= {occurredUntil:DateTime64(3)}
      AND TraceId = {traceId:String}
      AND KeyVersion = {keyVersion:UInt16}
      AND Source != {monitor:String}
    GROUP BY SpanId, QuestionHash, JudgedColumn
  )
  ORDER BY LatestJudgedAt DESC, SpanId, QuestionHash, JudgedColumn
  LIMIT ${INSTANT_EVAL_RESULTS_CEILING}`;

export class ClickHouseEvalResultsRepository implements EvalResultsRepository {
  private constructor(private readonly resolveClient: InstantEvalClickHouseResolver) {}

  static create({
    resolveClient,
  }: {
    resolveClient: InstantEvalClickHouseResolver;
  }): ClickHouseEvalResultsRepository {
    return new ClickHouseEvalResultsRepository(resolveClient);
  }

  async insert(records: readonly EvalResultRecord[]): Promise<void> {
    const [first] = records;
    if (!first) return;

    // One tenant per call, checked rather than trusted: this value chooses which ClickHouse
    // the batch is written to, so a mixed batch would land one project's results in another's.
    const tenantId = first.TenantId;
    const foreign = records.find((record) => record.TenantId !== tenantId);
    if (foreign) {
      throw new Error(
        `eval_results batch mixes tenants (${tenantId} and ${foreign.TenantId}); refusing to write`,
      );
    }

    const client = await this.resolveClient(tenantId);
    for (const batch of evalResultsInsertBatches(records)) {
      await client.insert({
        table: TABLE_NAME,
        values: batch.map(toEvalResultValues),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });
    }
    logger.debug(
      { tenantId, source: first.Source, sourceId: first.SourceId, count: records.length },
      "Instant Evals results written",
    );
  }

  async findLatestJudged(query: EvalResultsRecallQuery): Promise<readonly RecalledEvalResult[]> {
    if (query.keys.length === 0) return [];
    const client = await this.resolveClient(query.tenantId);
    const result = await client.query<RecalledEvalResultRow>({
      query: RECALL_QUERY,
      query_params: evalResultsRecallParameters(query),
      format: "JSONEachRow",
    });

    return (await result.json()).map(toRecalledEvalResult);
  }

  async findLatestByTrace(query: EvalResultsTraceQuery): Promise<readonly EvalTraceResult[]> {
    const client = await this.resolveClient(query.tenantId);
    const result = await client.query({
      query: TRACE_QUERY,
      query_params: evalResultsTraceParameters(query),
      format: "JSONEachRow",
    });

    return traceRowsSchema.parse(await result.json()).map(toEvalTraceResult);
  }

  /** Per project, so each read routes to the tenant's server; FINAL, as the report always read. */
  async countJudged({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    const window =
      since === undefined ? "" : "AND JudgedAt >= fromUnixTimestamp64Milli({since:Int64})";
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT toString(count()) AS Total
            FROM ${TABLE_NAME} FINAL
            WHERE TenantId = {tenantId:String}
              AND Status = {status:String}
              ${window}`,
          query_params:
            since === undefined
              ? { tenantId, status: "judged" }
              : { tenantId, status: "judged", since },
          format: "JSONEachRow",
        });
        const [row] = totalRowsSchema.parse(await result.json());
        return Number.parseInt(row?.Total ?? "0", 10);
      }),
    );
    return perProject.reduce((sum, total) => sum + total, 0);
  }
}
