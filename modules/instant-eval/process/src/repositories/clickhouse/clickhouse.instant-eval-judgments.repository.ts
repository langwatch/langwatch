import { createLogger } from "@langwatch/observability";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import type { InstantEvalClickHouseResolver } from "../../app/instant-eval.members.ts";
import type {
  InstantEvalJudgment,
  InstantEvalJudgmentPage,
  InstantEvalJudgmentQuery,
  InstantEvalJudgmentRecord,
  InstantEvalJudgmentSampleQuery,
  InstantEvalJudgmentsRepository,
} from "../instant-eval-judgments.repository.ts";
import {
  buildFilters,
  encodeInstantEvalCursor,
  type JudgmentRow,
  toJudgment,
} from "./clickhouse.instant-eval-judgments.mapper.ts";

const TABLE_NAME = "instant_eval_judgments" as const;

const totalRowsSchema = z.array(z.object({ Total: z.string() }));

const logger = createLogger("langwatch:instant-evals:judgments-repository");

/**
 * argMax over the version column rather than FINAL: the dedup is eventual, and
 * a page has to be the latest version of each verdict without materialising
 * every column of every granule.
 */
const VERDICT_COLUMNS = `
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
          argMax(OccurredAt, UpdatedAt) AS OccurredAt`;

export class ClickHouseInstantEvalJudgmentsRepository implements InstantEvalJudgmentsRepository {
  private constructor(private readonly resolveClient: InstantEvalClickHouseResolver) {}

  static create({
    resolveClient,
  }: {
    resolveClient: InstantEvalClickHouseResolver;
  }): ClickHouseInstantEvalJudgmentsRepository {
    return new ClickHouseInstantEvalJudgmentsRepository(resolveClient);
  }

  /** Per project, so each read routes to the tenant's server; FINAL, as the report always read. */
  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<number> {
    const window =
      since === undefined ? "" : "AND CreatedAt >= fromUnixTimestamp64Milli({since:Int64})";
    const perProject = await Promise.all(
      [...new Set(projectIds)].map(async (tenantId) => {
        const client = await this.resolveClient(tenantId);
        const result = await client.query({
          query: `
            SELECT toString(count()) AS Total
            FROM ${TABLE_NAME} FINAL
            WHERE TenantId = {tenantId:String}
              ${window}`,
          query_params: since === undefined ? { tenantId } : { tenantId, since },
          format: "JSONEachRow",
        });
        const [row] = totalRowsSchema.parse(await result.json());
        return Number.parseInt(row?.Total ?? "0", 10);
      }),
    );
    return perProject.reduce((sum, total) => sum + total, 0);
  }

  async insert(records: readonly InstantEvalJudgmentRecord[]): Promise<void> {
    const [first] = records;
    if (!first) return;

    // One tenant per call, checked rather than trusted: this value chooses
    // which ClickHouse the batch is written to, so a mixed batch would land
    // one project's judgements in another's.
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
        OccurredAt: atEpoch(record.OccurredAt),
        CreatedAt: atEpoch(record.CreatedAt),
        UpdatedAt: atEpoch(record.UpdatedAt),
      })),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
    });
    logger.debug(
      { tenantId, runId: first.RunId, count: records.length },
      "Instant Eval judgements written",
    );
  }

  async getPage(query: InstantEvalJudgmentQuery): Promise<InstantEvalJudgmentPage> {
    const { where, having, parameters } = buildFilters(query);
    const client = await this.resolveClient(query.projectId);
    // One row past the page, so "there is more" needs no second query.
    const limit = query.limit + 1;

    const result = await client.query<JudgmentRow>({
      query: `
        SELECT ${VERDICT_COLUMNS}
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
        writtenFrom: toDate(query.writtenFrom),
        writtenUntil: toDate(query.writtenUntil),
        limit,
      },
      format: "JSONEachRow",
    });

    const rows = await result.json();
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      judgments: page.map(toJudgment),
      ...(rows.length > query.limit && last
        ? { nextCursor: encodeInstantEvalCursor(toJudgment(last)) }
        : {}),
    };
  }

  async findSample(query: InstantEvalJudgmentSampleQuery): Promise<readonly InstantEvalJudgment[]> {
    const client = await this.resolveClient(query.projectId);
    const bounds = `
      WHERE TenantId = {tenantId:String}
        AND RunId = {runId:String}
        AND CreatedAt >= {writtenFrom:DateTime64(3)}
        AND CreatedAt <= {writtenUntil:DateTime64(3)}
    `;
    // The hash of the trace and the seed is the ordering: deterministic for a
    // given seed, so paging the same sample twice agrees, and different for
    // the next call, so a caller is not shown one corner of the run forever.
    const order = query.shouldPreferMatched
      ? "max(Passed) DESC, cityHash64(TraceId, {seed:UInt64})"
      : "cityHash64(TraceId, {seed:UInt64})";

    const result = await client.query<JudgmentRow>({
      query: `
        SELECT ${VERDICT_COLUMNS}
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
        writtenFrom: toDate(query.writtenFrom),
        writtenUntil: toDate(query.writtenUntil),
        traces: query.traces,
        seed: query.seed,
      },
      format: "JSONEachRow",
    });

    return (await result.json()).map(toJudgment);
  }
}

/** The driver formats dates, so the record's epoch millis become one here. */
function atEpoch(at: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(at));
}
