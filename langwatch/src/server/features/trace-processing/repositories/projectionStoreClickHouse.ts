import { type ClickHouseClient } from "@clickhouse/client";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";

import type {
  ProjectionStore,
  ProjectionStoreContext,
  ProjectionStoreWriteCtx,
} from "./projectionStore";
import type { TraceProjection } from "../types";
import { createLogger } from "../../../../utils/logger";

const PROJECTION_SCHEMA_VERSION = "v1";

export class ProjectionStoreClickHouse implements ProjectionStore {
  tracer = getLangWatchTracer("langwatch.trace-processing.projection-store.clickhouse");
  logger = createLogger("langwatch:trace-processing:projection-store:clickhouse");

  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getProjection(
    traceId: string,
    context?: ProjectionStoreContext
  ): Promise<TraceProjection | null> {
    const tenantId = context?.tenantId;
    if (!tenantId) {
      throw new Error("Tenant ID is required to read projections");
    }

    return await this.tracer.withActiveSpan(
      "ProjectionStoreClickHouse.getProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "trace.id": traceId,
          "tenant.id": tenantId,
        },
      },
      async () => {
        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT *
              FROM trace_projections
              WHERE TenantId = {tenantId:String} AND TraceId = {traceId:String}
              ORDER BY Version DESC
              LIMIT 1
            `,
            query_params: {
              tenantId,
              traceId,
            },
            format: "JSONEachRow",
          });

          const rowsResponse = (await result.json()) as TraceProjectionRow[] | undefined;
          const rows = rowsResponse ?? [];
          if (rows.length === 0) {
            return null;
          }

          const [row] = rows;
          if (!row) {
            return null;
          }
          return this.mapRowToProjection(row);
        } catch (error) {
          this.logger.error(
            {
              traceId,
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to get projection from ClickHouse"
          );
          throw error;
        }
      }
    );
  }

  async storeProjection(
    projection: TraceProjection,
    context?: ProjectionStoreWriteCtx
  ): Promise<void> {
    const tenantId = context?.tenantId ?? projection.data.tenantId;

    return await this.tracer.withActiveSpan(
      "ProjectionStoreClickHouse.storeProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "trace.id": projection.aggregateId,
          "projection.id": projection.id,
          "tenant.id": tenantId,
        },
      },
      async () => {
        try {
          await this.clickHouseClient.insert({
            table: "trace_projections",
            values: [this.buildInsertRecord(projection, tenantId)],
            format: "JSONEachRow",
          });
        } catch (error) {
          this.logger.error(
            {
              traceId: projection.data.traceId,
              projectionId: projection.id,
              tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to store projection in ClickHouse"
          );
          throw error;
        }
      }
    );
  }

  private buildInsertRecord(
    projection: TraceProjection,
    tenantId: string
  ): TraceProjectionInsert {
    const data = projection.data;
    return {
      Id: projection.id,
      TenantId: tenantId,
      TraceId: data.traceId,
      Version: projection.version,
      IOSchemaVersion: PROJECTION_SCHEMA_VERSION,
      ComputedInput: data.computedInput ?? null,
      ComputedOutput: data.computedOutput ?? null,
      ComputedMetadata: data.computedMetadata ?? {},
      TimeToFirstTokenMs: data.timeToFirstTokenMs ?? null,
      TimeToLastTokenMs: data.timeToLastTokenMs ?? null,
      TotalDurationMs: data.totalDurationMs,
      TokensPerSecond: data.tokensPerSecond ?? null,
      SpanCount: data.spanCount,
      ContainsErrorStatus: data.containsErrorStatus,
      ContainsOKStatus: data.containsOKStatus,
      Models: data.models ?? null,
      TopicId: data.topicId ?? null,
      SubTopicId: data.subTopicId ?? null,
      TotalPromptTokenCount: data.totalPromptTokenCount ?? null,
      TotalCompletionTokenCount: data.totalCompletionTokenCount ?? null,
      HasAnnotation: data.hasAnnotation ?? null,
      CreatedAt: data.createdAt,
      LastUpdatedAt: data.lastUpdatedAt,
    };
  }

  private mapRowToProjection(row: TraceProjectionRow): TraceProjection {
    return {
      id: row.Id,
      aggregateId: row.TraceId,
      version: new Date(row.Version).getTime(),
      data: {
        tenantId: row.TenantId,
        traceId: row.TraceId,
        computedInput: row.ComputedInput ?? null,
        computedOutput: row.ComputedOutput ?? null,
        computedMetadata: row.ComputedMetadata ?? {},
        timeToFirstTokenMs: row.TimeToFirstTokenMs === null ? null : Number(row.TimeToFirstTokenMs),
        timeToLastTokenMs: row.TimeToLastTokenMs === null ? null : Number(row.TimeToLastTokenMs),
        totalDurationMs: Number(row.TotalDurationMs),
        tokensPerSecond: row.TokensPerSecond === null ? null : Number(row.TokensPerSecond),
        spanCount: Number(row.SpanCount),
        containsErrorStatus: Boolean(row.ContainsErrorStatus),
        containsOKStatus: Boolean(row.ContainsOKStatus),
        models: row.Models ?? null,
        topicId: row.TopicId ?? null,
        subTopicId: row.SubTopicId ?? null,
        totalPromptTokenCount:
          row.TotalPromptTokenCount === null ? null : Number(row.TotalPromptTokenCount),
        totalCompletionTokenCount:
          row.TotalCompletionTokenCount === null ? null : Number(row.TotalCompletionTokenCount),
        hasAnnotation: row.HasAnnotation === null ? null : Boolean(row.HasAnnotation),
        createdAt: new Date(row.CreatedAt).getTime(),
        lastUpdatedAt: new Date(row.LastUpdatedAt).getTime(),
      },
    };
  }
}

type TraceProjectionRow = {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: string;
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string> | null;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: number | boolean;
  ContainsOKStatus: number | boolean;
  Models: string | null;
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
  CreatedAt: string;
  LastUpdatedAt: string;
};

type TraceProjectionInsert = {
  Id: string;
  TenantId: string;
  TraceId: string;
  Version: number;
  IOSchemaVersion: string;
  ComputedInput: string | null;
  ComputedOutput: string | null;
  ComputedMetadata: Record<string, string>;
  TimeToFirstTokenMs: number | null;
  TimeToLastTokenMs: number | null;
  TotalDurationMs: number;
  TokensPerSecond: number | null;
  SpanCount: number;
  ContainsErrorStatus: boolean;
  ContainsOKStatus: boolean;
  Models: string | null;
  TopicId: string | null;
  SubTopicId: string | null;
  TotalPromptTokenCount: number | null;
  TotalCompletionTokenCount: number | null;
  HasAnnotation: boolean | null;
  CreatedAt: number;
  LastUpdatedAt: number;
};
