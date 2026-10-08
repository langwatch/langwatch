import { EventUtils, type FoldStateRead, type ProjectionStoreContext } from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import {
  type TraceAnnotationScoreFoldState,
  TraceAnnotationScoresReadRepository,
  type TraceAnnotationScoresRepository,
} from "../trace-annotation-scores.repository.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const TABLE_NAME = "trace_annotation_scores" as const;

const scoreRowSchema = z.looseObject({
  ScoreId: chString,
  Name: chString,
  Revision: chNumber,
  NamedAtMs: chNumber,
  LastEventOccurredAtMs: chNumber,
});
const scoreRowsSchema = z.array(scoreRowSchema);
type ScoreRow = z.infer<typeof scoreRowSchema>;

function clickHouseTimestamp(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

/** Trace's folded score names in `trace_annotation_scores` (00108): fold store and read. */
export class ClickHouseTraceAnnotationScoresRepository
  extends TraceAnnotationScoresReadRepository
  implements TraceAnnotationScoresRepository
{
  static create(
    resolveClient: TraceClickHouseWriteResolver,
  ): ClickHouseTraceAnnotationScoresRepository {
    return new ClickHouseTraceAnnotationScoresRepository(resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseWriteResolver) {
    super();
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceAnnotationScoreFoldState>> {
    const [row] = await this.latestRows({ tenantId: context.tenantId, scoreId: aggregateId });
    return row
      ? {
          kind: "folded",
          state: {
            scoreId: row.ScoreId,
            name: row.Name,
            namedAt: row.NamedAtMs,
            revision: row.Revision,
            LastEventOccurredAt: row.LastEventOccurredAtMs,
          },
        }
      : { kind: "empty" };
  }

  async store(
    state: TraceAnnotationScoreFoldState,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const tenantId = context.tenantId;
    EventUtils.validateTenantId({ tenantId }, "ClickHouseTraceAnnotationScoresRepository.store");
    // A score with no name yet has nothing a reader could show.
    if (state.name === null) return;
    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: [
        {
          TenantId: tenantId,
          ScoreId: state.scoreId || context.aggregateId,
          Name: state.name,
          NamedAt: clickHouseTimestamp(state.namedAt),
          LastEventOccurredAt: clickHouseTimestamp(state.LastEventOccurredAt),
          Revision: state.revision,
        },
      ],
      format: "JSONEachRow",
    });
  }

  async findScoreNames({
    projectId,
  }: {
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    const rows = await this.latestRows({ tenantId: projectId });
    return rows.map((row) => ({ id: row.ScoreId, name: row.Name }));
  }

  private async latestRows({
    tenantId,
    scoreId,
  }: {
    tenantId: string;
    scoreId?: string;
  }): Promise<ScoreRow[]> {
    EventUtils.validateTenantId(
      { tenantId },
      "ClickHouseTraceAnnotationScoresRepository.latestRows",
    );
    const byId = scoreId === undefined ? "" : "AND ScoreId = {scoreId:String}";
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT
          ScoreId,
          Name,
          Revision,
          toUnixTimestamp64Milli(NamedAt) AS NamedAtMs,
          toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAtMs
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          ${byId}
          AND (TenantId, ScoreId, Revision) IN (
            SELECT TenantId, ScoreId, max(Revision)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              ${byId}
            GROUP BY TenantId, ScoreId
          )
        LIMIT 1 BY ScoreId
      `,
      query_params: { tenantId, ...(scoreId === undefined ? {} : { scoreId }) },
      format: "JSONEachRow",
    });
    return scoreRowsSchema.parse(await result.json());
  }
}
