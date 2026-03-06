import type { ClickHouseClient } from "@clickhouse/client";
import type { WithDateWrites } from "~/server/clickhouse/types";
import {
  ErrorCategory,
  StoreError,
} from "~/server/event-sourcing/services/errorHandling";
import { createLogger } from "../../../../../utils/logger";
import type { SuiteRunItemData } from "../projections/suiteRunItems.foldProjection";
import type { SuiteRunItemsRepository } from "./suiteRunItems.repository";

const TABLE_NAME = "suite_run_items" as const;

const logger = createLogger(
  "langwatch:suite-run-processing:run-items-repository",
);

interface ClickHouseSuiteRunItemRecord {
  ProjectionId: string;
  TenantId: string;
  SuiteId: string;
  BatchRunId: string;
  ScenarioRunId: string;
  ScenarioId: string;
  TargetReferenceId: string;
  TargetType: string;
  Status: string;
  Verdict: string | null;
  DurationMs: number | null;
  StartedAt: number | null;
  FinishedAt: number | null;
  UpdatedAt: number;
}

type ClickHouseSuiteRunItemWriteRecord = WithDateWrites<
  ClickHouseSuiteRunItemRecord,
  "StartedAt" | "FinishedAt" | "UpdatedAt"
>;

export class SuiteRunItemsRepositoryClickHouse implements SuiteRunItemsRepository {
  constructor(private readonly clickHouseClient: ClickHouseClient) {}

  async getItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
  }): Promise<SuiteRunItemData[]> {
    try {
      const result = await this.clickHouseClient.query({
        query: `
          SELECT
            ScenarioRunId, ScenarioId,
            TargetReferenceId, TargetType,
            Status, Verdict, DurationMs,
            toUnixTimestamp64Milli(StartedAt) AS StartedAt,
            toUnixTimestamp64Milli(FinishedAt) AS FinishedAt,
            toUnixTimestamp64Milli(UpdatedAt) AS UpdatedAt
          FROM ${TABLE_NAME}
          WHERE TenantId = {tenantId:String}
            AND SuiteId = {suiteId:String}
            AND BatchRunId = {batchRunId:String}
        `,
        query_params: params,
        format: "JSONEachRow",
      });

      const rows = await result.json<ClickHouseSuiteRunItemRecord>();
      return rows.map((row) => ({
        ScenarioRunId: row.ScenarioRunId,
        ScenarioId: row.ScenarioId,
        TargetReferenceId: row.TargetReferenceId,
        TargetType: row.TargetType,
        Status: row.Status,
        Verdict: row.Verdict,
        DurationMs: row.DurationMs === null ? null : Number(row.DurationMs),
        StartedAt: row.StartedAt === null ? null : Number(row.StartedAt),
        FinishedAt: row.FinishedAt === null ? null : Number(row.FinishedAt),
        UpdatedAt: Number(row.UpdatedAt),
      }));
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { ...params, error: errorMessage },
        "Failed to get items from ClickHouse",
      );
      throw new StoreError(
        "getItems",
        "SuiteRunItemsRepositoryClickHouse",
        `Failed to get items for suite run ${params.suiteId}:${params.batchRunId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        params,
        error,
      );
    }
  }

  async storeItems(params: {
    tenantId: string;
    suiteId: string;
    batchRunId: string;
    projectionId: string;
    items: SuiteRunItemData[];
  }): Promise<void> {
    if (params.items.length === 0) return;

    try {
      const records: ClickHouseSuiteRunItemWriteRecord[] = params.items.map(
        (item) => ({
          ProjectionId: params.projectionId,
          TenantId: params.tenantId,
          SuiteId: params.suiteId,
          BatchRunId: params.batchRunId,
          ScenarioRunId: item.ScenarioRunId,
          ScenarioId: item.ScenarioId,
          TargetReferenceId: item.TargetReferenceId,
          TargetType: item.TargetType,
          Status: item.Status,
          Verdict: item.Verdict,
          DurationMs: item.DurationMs,
          StartedAt: item.StartedAt != null ? new Date(item.StartedAt) : null,
          FinishedAt: item.FinishedAt != null ? new Date(item.FinishedAt) : null,
          UpdatedAt: new Date(item.UpdatedAt),
        }),
      );

      await this.clickHouseClient.insert({
        table: TABLE_NAME,
        values: records,
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 1, wait_for_async_insert: 1 },
      });

      logger.debug(
        { tenantId: params.tenantId, suiteId: params.suiteId, count: params.items.length },
        "Stored suite run items to ClickHouse",
      );
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(
        { ...params, error: errorMessage },
        "Failed to store items in ClickHouse",
      );
      throw new StoreError(
        "storeItems",
        "SuiteRunItemsRepositoryClickHouse",
        `Failed to store items for suite run ${params.suiteId}:${params.batchRunId}: ${errorMessage}`,
        ErrorCategory.CRITICAL,
        { suiteId: params.suiteId, batchRunId: params.batchRunId },
        error,
      );
    }
  }
}
