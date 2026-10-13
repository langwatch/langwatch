/**
 * Instant-eval's `instant_eval_runs`, shared with trace for reading: each run
 * collapsed to its latest version, as instant-eval's own lookup collapses it.
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import {
  type TraceInstantEvalRunRow,
  TraceInstantEvalRunsReadRepository,
} from "../trace-instant-eval-runs.repository.ts";
import type { TraceClickHouseResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const INSTANT_EVAL_RUNS_TABLE = "instant_eval_runs" as const;

const runRowsSchema = z.array(
  z.looseObject({ RunId: chString, CreatedAt: chNumber, FinishedAt: chNumber.nullable() }),
);

export class ClickHouseTraceInstantEvalRunsRepository extends TraceInstantEvalRunsReadRepository {
  static create(options: {
    resolveClient: TraceClickHouseResolver;
  }): ClickHouseTraceInstantEvalRunsRepository {
    return new ClickHouseTraceInstantEvalRunsRepository(options.resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseResolver) {
    super();
  }

  async findRunsByIds({
    projectId,
    runIds,
  }: {
    projectId: string;
    runIds: readonly string[];
  }): Promise<TraceInstantEvalRunRow[]> {
    if (runIds.length === 0) return [];
    const client = await this.resolveClient(projectId);
    const result = await client.query({
      query: `
        SELECT
          t.RunId AS RunId,
          toUnixTimestamp64Milli(t.CreatedAt) AS CreatedAt,
          toUnixTimestamp64Milli(t.FinishedAt) AS FinishedAt
        FROM ${INSTANT_EVAL_RUNS_TABLE} AS t
        WHERE t.TenantId = {tenantId:String}
          AND t.RunId IN ({runIds:Array(String)})
          AND (t.TenantId, t.RunId, (t.WrittenAt, ifNull(t.AcceptedAt, toDateTime64(0, 3)), t.LastEventId)) IN (
            SELECT TenantId, RunId, max((WrittenAt, ifNull(AcceptedAt, toDateTime64(0, 3)), LastEventId))
            FROM ${INSTANT_EVAL_RUNS_TABLE}
            WHERE TenantId = {tenantId:String}
              AND RunId IN ({runIds:Array(String)})
            GROUP BY TenantId, RunId
          )
        LIMIT 1 BY t.RunId
      `,
      query_params: { tenantId: projectId, runIds: [...new Set(runIds)] },
      format: "JSONEachRow",
    });
    return runRowsSchema.parse(await result.json()).map((row) => ({
      runId: row.RunId,
      createdAt: Temporal.Instant.fromEpochMilliseconds(row.CreatedAt),
      finishedAt:
        row.FinishedAt === null ? null : Temporal.Instant.fromEpochMilliseconds(row.FinishedAt),
    }));
  }
}
