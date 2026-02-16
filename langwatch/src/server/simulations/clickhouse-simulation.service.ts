import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import type { ScenarioRunData } from "~/app/api/scenario-events/[[...route]]/types";
import type { ScenarioSetData } from "~/app/api/scenario-events/[[...route]]/types";
import type { ClickHouseSimulationRunRow } from "./simulation-run.mappers";
import { mapClickHouseRowToScenarioRunData } from "./simulation-run.mappers";

const logger = createLogger("langwatch:simulations:clickhouse-service");
const tracer = getLangWatchTracer("langwatch.simulations.clickhouse-service");

/**
 * Service for fetching simulation run data from ClickHouse.
 *
 * Returns `null` when ClickHouse client is unavailable, allowing
 * the facade to throw or fall back as appropriate.
 *
 * Queries the `simulation_runs` table using `FINAL` to collapse
 * ReplacingMergeTree versions.
 */
export class ClickHouseSimulationService {
  private readonly clickHouseClient: ClickHouseClient | null;

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseClient = getClickHouseClient();
  }

  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ClickHouseSimulationService {
    return new ClickHouseSimulationService(prisma);
  }

  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.isClickHouseEnabled",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          return false;
        }

        const project = await this.prisma.project.findUnique({
          where: { id: projectId },
          select: { featureClickHouseDataSourceSimulations: true },
        });

        const enabled =
          project?.featureClickHouseDataSourceSimulations === true;
        span.setAttribute(
          "project.feature.clickhouse.simulations",
          enabled,
        );

        return enabled;
      },
    );
  }

  async getScenarioSetsData(
    projectId: string,
  ): Promise<ScenarioSetData[] | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getScenarioSetsData",
      { attributes: { "tenant.id": projectId } },
      async () => {
        if (!this.clickHouseClient) return null;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ScenarioSetId,
                count(DISTINCT ScenarioId) AS scenarioCount,
                toUnixTimestamp64Milli(max(CreatedAt)) AS lastRunAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND DeletedAt IS NULL
              GROUP BY ScenarioSetId
            `,
            query_params: { tenantId: projectId },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            ScenarioSetId: string;
            scenarioCount: string;
            lastRunAt: string;
          }>;

          return rows.map((row) => ({
            scenarioSetId: row.ScenarioSetId,
            scenarioCount: Number(row.scenarioCount),
            lastRunAt: Number(row.lastRunAt),
          }));
        } catch (error) {
          logger.error(
            { projectId, error: error instanceof Error ? error.message : error },
            "Failed to fetch scenario sets data from ClickHouse",
          );
          throw new Error("Failed to fetch scenario sets data");
        }
      },
    );
  }

  async getRunDataForBatchRun({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<ScenarioRunData[] | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getRunDataForBatchRun",
      {
        attributes: {
          "tenant.id": projectId,
          "batch.run.id": batchRunId,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
                Status, Name, Description, Messages,
                Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
                DurationMs,
                toUnixTimestamp64Milli(CreatedAt) AS CreatedAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND BatchRunId = {batchRunId:String}
                AND DeletedAt IS NULL
            `,
            query_params: { tenantId: projectId, batchRunId },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseSimulationRunRow[];
          return rows.map(mapClickHouseRowToScenarioRunData);
        } catch (error) {
          logger.error(
            { projectId, batchRunId, error: error instanceof Error ? error.message : error },
            "Failed to fetch run data for batch run from ClickHouse",
          );
          throw new Error("Failed to fetch run data for batch run");
        }
      },
    );
  }

  async getScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunData | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getScenarioRunData",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
                Status, Name, Description, Messages,
                Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
                DurationMs,
                toUnixTimestamp64Milli(CreatedAt) AS CreatedAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND ScenarioRunId = {scenarioRunId:String}
                AND DeletedAt IS NULL
              LIMIT 1
            `,
            query_params: { tenantId: projectId, scenarioRunId },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseSimulationRunRow[];
          return rows.length > 0
            ? mapClickHouseRowToScenarioRunData(rows[0]!)
            : null;
        } catch (error) {
          logger.error(
            { projectId, scenarioRunId, error: error instanceof Error ? error.message : error },
            "Failed to fetch scenario run data from ClickHouse",
          );
          throw new Error("Failed to fetch scenario run data");
        }
      },
    );
  }

  async getScenarioRunDataByScenarioId({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }): Promise<ScenarioRunData[] | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getScenarioRunDataByScenarioId",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.id": scenarioId,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
                Status, Name, Description, Messages,
                Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
                DurationMs,
                toUnixTimestamp64Milli(CreatedAt) AS CreatedAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND ScenarioId = {scenarioId:String}
                AND DeletedAt IS NULL
            `,
            query_params: { tenantId: projectId, scenarioId },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseSimulationRunRow[];
          return rows.map(mapClickHouseRowToScenarioRunData);
        } catch (error) {
          logger.error(
            { projectId, scenarioId, error: error instanceof Error ? error.message : error },
            "Failed to fetch scenario run data by scenario id from ClickHouse",
          );
          throw new Error("Failed to fetch scenario run data by scenario id");
        }
      },
    );
  }

  async getBatchRunIdsForScenarioSet({
    projectId,
    scenarioSetId,
    limit,
    cursor,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    batchRunIds: string[];
    nextCursor: string | undefined;
    hasMore: boolean;
  } | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getBatchRunIdsForScenarioSet",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
          "pagination.limit": limit,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        const offset = cursor ? Number(cursor) : 0;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                BatchRunId,
                max(CreatedAt) AS latestCreatedAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND ScenarioSetId = {scenarioSetId:String}
                AND DeletedAt IS NULL
              GROUP BY BatchRunId
              ORDER BY latestCreatedAt DESC
              LIMIT {limit:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              tenantId: projectId,
              scenarioSetId,
              limit: limit + 1, // fetch one extra to detect hasMore
              offset,
            },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{
            BatchRunId: string;
            latestCreatedAt: string;
          }>;

          const hasMore = rows.length > limit;
          const batchRunIds = rows.slice(0, limit).map((r) => r.BatchRunId);
          const nextCursor = hasMore
            ? String(offset + limit)
            : undefined;

          return { batchRunIds, nextCursor, hasMore };
        } catch (error) {
          logger.error(
            { projectId, scenarioSetId, error: error instanceof Error ? error.message : error },
            "Failed to fetch batch run ids from ClickHouse",
          );
          throw new Error("Failed to fetch batch run ids");
        }
      },
    );
  }

  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getBatchRunCountForScenarioSet",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT count(DISTINCT BatchRunId) AS cnt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND ScenarioSetId = {scenarioSetId:String}
                AND DeletedAt IS NULL
            `,
            query_params: { tenantId: projectId, scenarioSetId },
            format: "JSONEachRow",
          });

          const rows = (await result.json()) as Array<{ cnt: string }>;
          return rows.length > 0 ? Number(rows[0]!.cnt) : 0;
        } catch (error) {
          logger.error(
            { projectId, scenarioSetId, error: error instanceof Error ? error.message : error },
            "Failed to fetch batch run count from ClickHouse",
          );
          throw new Error("Failed to fetch batch run count");
        }
      },
    );
  }

  async softDeleteAllForProject(projectId: string): Promise<void> {
    if (!this.clickHouseClient) return;

    try {
      await this.clickHouseClient.command({
        query: `
          ALTER TABLE simulation_runs
            UPDATE
              DeletedAt = now64(3),
              UpdatedAt = now64(3),
              Messages = '[]',
              TraceIds = '[]',
              MetCriteria = '[]',
              UnmetCriteria = '[]',
              Verdict = NULL,
              Reasoning = NULL,
              Error = NULL,
              Name = NULL,
              Description = NULL,
              DurationMs = NULL
            WHERE TenantId = {tenantId:String} AND DeletedAt IS NULL
        `,
        query_params: { tenantId: projectId },
      });

      logger.info(
        { projectId },
        "Soft-deleted all simulation runs for project in ClickHouse",
      );
    } catch (error) {
      logger.error(
        { projectId, error: error instanceof Error ? error.message : error },
        "Failed to soft-delete simulation runs in ClickHouse",
      );
      throw new Error("Failed to soft-delete simulation runs");
    }
  }

  async getRunDataForBatchIds({
    projectId,
    batchRunIds,
  }: {
    projectId: string;
    batchRunIds: string[];
  }): Promise<ScenarioRunData[] | null> {
    return tracer.withActiveSpan(
      "ClickHouseSimulationService.getRunDataForBatchIds",
      {
        attributes: {
          "tenant.id": projectId,
          "batch_run_ids.count": batchRunIds.length,
        },
      },
      async () => {
        if (!this.clickHouseClient) return null;

        if (batchRunIds.length === 0) return [];

        try {
          const result = await this.clickHouseClient.query({
            query: `
              SELECT
                ScenarioRunId, ScenarioId, BatchRunId, ScenarioSetId,
                Status, Name, Description, Messages,
                Verdict, Reasoning, MetCriteria, UnmetCriteria, Error,
                DurationMs,
                toUnixTimestamp64Milli(CreatedAt) AS CreatedAt
              FROM simulation_runs FINAL
              WHERE TenantId = {tenantId:String}
                AND BatchRunId IN ({batchRunIds:Array(String)})
                AND DeletedAt IS NULL
            `,
            query_params: { tenantId: projectId, batchRunIds },
            format: "JSONEachRow",
          });

          const rows =
            (await result.json()) as ClickHouseSimulationRunRow[];
          return rows.map(mapClickHouseRowToScenarioRunData);
        } catch (error) {
          logger.error(
            { projectId, batchRunIds, error: error instanceof Error ? error.message : error },
            "Failed to fetch run data for batch ids from ClickHouse",
          );
          throw new Error("Failed to fetch run data for batch ids");
        }
      },
    );
  }
}
