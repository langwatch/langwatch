import type { ClickHouseClient } from "@clickhouse/client";
import { parse } from "date-fns";
import {
  ErrorCategory,
  SecurityError,
  StoreError,
  ValidationError,
} from "~/server/event-sourcing/library/services/errorHandling";
import { createLogger } from "../../../../../utils/logger/server";
import type {
  Projection,
  ProjectionStoreReadContext,
  ProjectionStoreWriteContext,
} from "../../../library";
import { createTenantId, EventUtils } from "../../../library";
import type {
  EvaluationState,
  EvaluationStateData,
} from "../projections/evaluationState.projection.handler";
import type { EvaluationStateRepository } from "./evaluationState.repository";

const TABLE_NAME = "evaluation_states" as const;

const logger = createLogger(
  "langwatch:evaluation-processing:evaluation-state-repository",
);

/**
 * ClickHouse record matching the evaluation_states table schema exactly.
 */
interface ClickHouseEvaluationStateRecord {
  Id: string;
  TenantId: string;
  EvaluationId: string;
  Version: string;

  EvaluatorId: string;
  EvaluatorType: string;
  EvaluatorName: string | null;
  TraceId: string | null;
  IsGuardrail: number; // UInt8 in ClickHouse

  Status: string;

  Score: number | null;
  Passed: number | null; // UInt8 in ClickHouse
  Label: string | null;
  Details: string | null;
  Error: string | null;

  ScheduledAt: string | null; // DateTime64(3) as string
  StartedAt: string | null;
  CompletedAt: string | null;

  LastProcessedEventId: string;
}

/**
 * Converts a Unix millisecond timestamp to ClickHouse DateTime64(3) format.
 */
function timestampToDateTime64(timestampMs: number | null): string | null {
  if (timestampMs === null) return null;
  return timestampMs.toString();
}

/**
 * Converts a ClickHouse DateTime64(3) string to Unix millisecond timestamp.
 */
const CLICKHOUSE_DATETIME64_FORMAT = "yyyy-MM-dd HH:mm:ss.SSSX";

function dateTime64ToTimestamp(dateTime64: string | null): number | null {
  if (dateTime64 === null) return null;
  return parse(`${dateTime64}Z`, CLICKHOUSE_DATETIME64_FORMAT, new Date(0)).getTime();
}

/**
 * ClickHouse repository for evaluation states.
 */
export class EvaluationStateRepositoryClickHouse<
  ProjectionType extends Projection = Projection,
> implements EvaluationStateRepository<ProjectionType> {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  private mapClickHouseRecordToProjectionData(
    record: ClickHouseEvaluationStateRecord,
  ): EvaluationStateData {
    return {
      EvaluationId: record.EvaluationId,
      EvaluatorId: record.EvaluatorId,
      EvaluatorType: record.EvaluatorType,
      EvaluatorName: record.EvaluatorName,
      TraceId: record.TraceId,
      IsGuardrail: record.IsGuardrail === 1,
      Status: record.Status as EvaluationStateData["Status"],
      Score: record.Score,
      Passed: record.Passed === null ? null : record.Passed === 1,
      Label: record.Label,
      Details: record.Details,
      Error: record.Error,
      ScheduledAt: dateTime64ToTimestamp(record.ScheduledAt),
      StartedAt: dateTime64ToTimestamp(record.StartedAt),
      CompletedAt: dateTime64ToTimestamp(record.CompletedAt),
    };
  }

  private mapProjectionDataToClickHouseRecord(
    data: EvaluationStateData,
    tenantId: string,
    projectionId: string,
    projectionVersion: string,
    lastProcessedEventId: string,
  ): ClickHouseEvaluationStateRecord {
    return {
      Id: projectionId,
      TenantId: tenantId,
      EvaluationId: data.EvaluationId,
      Version: projectionVersion,

      EvaluatorId: data.EvaluatorId,
      EvaluatorType: data.EvaluatorType,
      EvaluatorName: data.EvaluatorName,
      TraceId: data.TraceId,
      IsGuardrail: data.IsGuardrail ? 1 : 0,

      Status: data.Status,

      Score: data.Score,
      Passed: data.Passed === null ? null : data.Passed ? 1 : 0,
      Label: data.Label,
      Details: data.Details,
      Error: data.Error,

      ScheduledAt: timestampToDateTime64(data.ScheduledAt),
      StartedAt: timestampToDateTime64(data.StartedAt),
      CompletedAt: timestampToDateTime64(data.CompletedAt),

      LastProcessedEventId: lastProcessedEventId,
    };
  }

  async getProjection(
    aggregateId: string,
    context: ProjectionStoreReadContext,
  ): Promise<ProjectionType | null> {
    EventUtils.validateTenantId(
      context,
      "EvaluationStateRepositoryClickHouse.getProjection",
    );

    const evaluationId = String(aggregateId);

    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            Id,
            TenantId,
            EvaluationId,
            Version,
            EvaluatorId,
            EvaluatorType,
            EvaluatorName,
            TraceId,
            IsGuardrail,
            Status,
            Score,
            Passed,
            Label,
            Details,
            Error,
            toString(ScheduledAt) AS ScheduledAt,
            toString(StartedAt) AS StartedAt,
            toString(CompletedAt) AS CompletedAt,
            LastProcessedEventId
          FROM ${TABLE_NAME} FINAL
          WHERE TenantId = {tenantId:String}
            AND EvaluationId = {evaluationId:String}
          ORDER BY UpdatedAt DESC
          LIMIT 1
        `,
        query_params: {
          tenantId: context.tenantId,
          evaluationId: evaluationId,
        },
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseEvaluationStateRecord>();
      const row = rows[0];
      if (!row) {
        return null;
      }

      const projectionData = this.mapClickHouseRecordToProjectionData(row);

      const projection: EvaluationState = {
        id: row.Id,
        aggregateId: evaluationId,
        tenantId: createTenantId(context.tenantId),
        version: row.Version,
        data: projectionData,
      };

      return projection as ProjectionType;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          evaluationId,
          tenantId: context.tenantId,
          error: errorMessage,
        },
        "Failed to get projection from ClickHouse",
      );
      throw new StoreError(
        "getProjection",
        "EvaluationStateRepositoryClickHouse",
        `Failed to get projection for evaluation ${evaluationId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { evaluationId },
        error,
      );
    }
  }

  async storeProjection(
    projection: ProjectionType,
    context: ProjectionStoreWriteContext,
  ): Promise<void> {
    EventUtils.validateTenantId(
      context,
      "EvaluationStateRepositoryClickHouse.storeProjection",
    );

    if (!EventUtils.isValidProjection(projection)) {
      throw new ValidationError(
        "Invalid projection: projection must have id, aggregateId, tenantId, version, and data",
        "projection",
        projection,
      );
    }

    if (projection.tenantId !== context.tenantId) {
      throw new SecurityError(
        "storeProjection",
        `Projection has tenantId '${projection.tenantId}' that does not match context tenantId '${context.tenantId}'`,
        projection.tenantId,
        { contextTenantId: context.tenantId },
      );
    }

    try {
      const evaluationId = String(projection.aggregateId);
      const projectionRecord = this.mapProjectionDataToClickHouseRecord(
        projection.data as EvaluationStateData,
        String(context.tenantId),
        projection.id,
        projection.version,
        projection.id, // Use projection ID as lastProcessedEventId for now
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: [projectionRecord],
        format: "JSONEachRow",
      });

      logger.debug(
        {
          tenantId: context.tenantId,
          evaluationId,
          projectionId: projection.id,
        },
        "Stored evaluation state projection to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        {
          tenantId: context.tenantId,
          evaluationId: String(projection.aggregateId),
          projectionId: projection.id,
          error: errorMessage,
        },
        "Failed to store projection in ClickHouse",
      );
      throw new StoreError(
        "storeProjection",
        "EvaluationStateRepositoryClickHouse",
        `Failed to store projection ${projection.id} for evaluation ${projection.aggregateId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        {
          projectionId: projection.id,
          evaluationId: String(projection.aggregateId),
        },
        error,
      );
    }
  }
}
