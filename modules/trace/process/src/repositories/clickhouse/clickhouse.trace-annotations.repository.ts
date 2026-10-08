import { annotationScoreOptionsSchema } from "@langwatch/annotation-contract";
import { EventUtils, type FoldStateRead, type ProjectionStoreContext } from "@langwatch/eventing";
import { Temporal, toDate } from "@langwatch/time";
import { z } from "zod";

import {
  type TraceAnnotationFoldState,
  type TraceAnnotationRow,
  TraceAnnotationsReadRepository,
  type TraceAnnotationsRepository,
} from "../trace-annotations.repository.ts";
import type { TraceClickHouseWriteResolver } from "./clickhouse.trace-member-client.repository.ts";
import { chNumber, chString } from "./stored-span-row.mapper.ts";

const TABLE_NAME = "trace_annotations" as const;

const COLUMNS = `
  AnnotationId, TraceId, Comment, IsThumbsUp, ExpectedOutput, ScoreOptions,
  AnchorKind, AnchorId, AnchorPath, HasContent, IsDeleted, Revision,
  toUnixTimestamp64Milli(CreatedAt) AS CreatedAtMs,
  toUnixTimestamp64Milli(ContentUpdatedAt) AS ContentUpdatedAtMs,
  toUnixTimestamp64Milli(LastEventOccurredAt) AS LastEventOccurredAtMs`;

const annotationRowSchema = z.looseObject({
  AnnotationId: chString,
  TraceId: chString,
  Comment: chString.nullable(),
  IsThumbsUp: chNumber.nullable(),
  ExpectedOutput: chString.nullable(),
  ScoreOptions: chString,
  AnchorKind: chString.nullable(),
  AnchorId: chString.nullable(),
  AnchorPath: chString.nullable(),
  HasContent: chNumber,
  IsDeleted: chNumber,
  Revision: chNumber,
  CreatedAtMs: chNumber,
  ContentUpdatedAtMs: chNumber,
  LastEventOccurredAtMs: chNumber,
});
const annotationRowsSchema = z.array(annotationRowSchema);
type AnnotationRow = z.infer<typeof annotationRowSchema>;

function clickHouseTimestamp(epochMs: number): Date {
  return toDate(Temporal.Instant.fromEpochMilliseconds(epochMs));
}

function stateOf(row: AnnotationRow): TraceAnnotationFoldState {
  return {
    annotationId: row.AnnotationId,
    traceId: row.TraceId,
    content:
      row.HasContent === 1
        ? {
            comment: row.Comment,
            isThumbsUp: row.IsThumbsUp === null ? null : row.IsThumbsUp === 1,
            expectedOutput: row.ExpectedOutput,
            scoreOptions: annotationScoreOptionsSchema.parse(JSON.parse(row.ScoreOptions)),
            anchorKind: row.AnchorKind,
            anchorId: row.AnchorId,
            anchorPath: row.AnchorPath,
            createdAt: row.CreatedAtMs,
            updatedAt: row.ContentUpdatedAtMs,
          }
        : null,
    deleted: row.IsDeleted === 1,
    revision: row.Revision,
    LastEventOccurredAt: row.LastEventOccurredAtMs,
  };
}

/** Trace's folded annotations in `trace_annotations` (00108): the fold's store and the read. */
export class ClickHouseTraceAnnotationsRepository
  extends TraceAnnotationsReadRepository
  implements TraceAnnotationsRepository
{
  static create(resolveClient: TraceClickHouseWriteResolver): ClickHouseTraceAnnotationsRepository {
    return new ClickHouseTraceAnnotationsRepository(resolveClient);
  }

  private constructor(private readonly resolveClient: TraceClickHouseWriteResolver) {
    super();
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<FoldStateRead<TraceAnnotationFoldState>> {
    const [row] = await this.latestRows({
      tenantId: context.tenantId,
      where: "AnnotationId = {annotationId:String}",
      params: { annotationId: aggregateId },
    });
    return row ? { kind: "folded", state: stateOf(row) } : { kind: "empty" };
  }

  async store(state: TraceAnnotationFoldState, context: ProjectionStoreContext): Promise<void> {
    const tenantId = context.tenantId;
    EventUtils.validateTenantId({ tenantId }, "ClickHouseTraceAnnotationsRepository.store");
    const content = state.content;
    const thumbsUp = content?.isThumbsUp ?? null;
    const client = await this.resolveClient(tenantId);
    await client.insert({
      table: TABLE_NAME,
      values: [
        {
          TenantId: tenantId,
          AnnotationId: state.annotationId || context.aggregateId,
          TraceId: state.traceId,
          Comment: content?.comment ?? null,
          IsThumbsUp: thumbsUp === null ? null : Number(thumbsUp),
          ExpectedOutput: content?.expectedOutput ?? null,
          ScoreOptions: JSON.stringify(content?.scoreOptions ?? {}),
          AnchorKind: content?.anchorKind ?? null,
          AnchorId: content?.anchorId ?? null,
          AnchorPath: content?.anchorPath ?? null,
          HasContent: content ? 1 : 0,
          CreatedAt: clickHouseTimestamp(content?.createdAt ?? 0),
          ContentUpdatedAt: clickHouseTimestamp(content?.updatedAt ?? 0),
          IsDeleted: state.deleted ? 1 : 0,
          LastEventOccurredAt: clickHouseTimestamp(state.LastEventOccurredAt),
          Revision: state.revision,
        },
      ],
      format: "JSONEachRow",
    });
  }

  async findForTraces({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<TraceAnnotationRow[]> {
    if (traceIds.length === 0) return [];
    const rows = await this.latestRows({
      tenantId: projectId,
      where: "TraceId IN ({traceIds:Array(String)})",
      params: { traceIds },
    });
    return rows
      .map(stateOf)
      .flatMap((state) =>
        state.deleted || state.content === null
          ? []
          : [{ ...state.content, id: state.annotationId, traceId: state.traceId }],
      )
      .toSorted((a, b) => a.createdAt - b.createdAt);
  }

  private async latestRows({
    tenantId,
    where,
    params,
  }: {
    tenantId: string;
    where: string;
    params: Record<string, unknown>;
  }): Promise<AnnotationRow[]> {
    EventUtils.validateTenantId({ tenantId }, "ClickHouseTraceAnnotationsRepository.latestRows");
    const client = await this.resolveClient(tenantId);
    const result = await client.query({
      query: `
        SELECT ${COLUMNS}
        FROM ${TABLE_NAME}
        WHERE TenantId = {tenantId:String}
          AND ${where}
          AND (TenantId, AnnotationId, Revision) IN (
            SELECT TenantId, AnnotationId, max(Revision)
            FROM ${TABLE_NAME}
            WHERE TenantId = {tenantId:String}
              AND ${where}
            GROUP BY TenantId, AnnotationId
          )
        LIMIT 1 BY AnnotationId
      `,
      query_params: { tenantId, ...params },
      format: "JSONEachRow",
    });
    return annotationRowsSchema.parse(await result.json());
  }
}
