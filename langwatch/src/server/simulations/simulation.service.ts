import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import type { ScenarioRunData, ScenarioSetData } from "~/app/api/scenario-events/[[...route]]/types";
import { ClickHouseSimulationService } from "./clickhouse-simulation.service";

const tracer = getLangWatchTracer("langwatch.simulations.service");

/**
 * Unified service for fetching simulation/scenario data from either
 * ClickHouse or Elasticsearch.
 *
 * When ClickHouse is enabled (`featureClickHouseDataSourceSimulations`),
 * it is the exclusive data source — no fallback to Elasticsearch.
 * If CH is enabled but returns null (client unavailable), we throw.
 */
export class SimulationService {
  private readonly clickHouseService: ClickHouseSimulationService;
  private readonly esService: ScenarioEventService;

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseSimulationService.create(prisma);
    this.esService = new ScenarioEventService();
  }

  static create(prisma: PrismaClient = defaultPrisma): SimulationService {
    return new SimulationService(prisma);
  }

  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ScenarioSetData[]> {
    return tracer.withActiveSpan(
      "SimulationService.getScenarioSetsDataForProject",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getScenarioSetsData(projectId);
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getScenarioSetsData — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.esService.getScenarioSetsDataForProject({ projectId });
      },
    );
  }

  async getRunDataForScenarioSet({
    projectId,
    scenarioSetId,
    limit = 20,
    cursor,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<{
    runs: ScenarioRunData[];
    nextCursor: string | undefined;
    hasMore: boolean;
  }> {
    return tracer.withActiveSpan(
      "SimulationService.getRunDataForScenarioSet",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const validatedLimit = Math.min(Math.max(1, limit), 100);

          const paginationResult =
            await this.clickHouseService.getBatchRunIdsForScenarioSet({
              projectId,
              scenarioSetId,
              limit: validatedLimit,
              cursor,
            });
          if (paginationResult === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getBatchRunIdsForScenarioSet — check ClickHouse client configuration",
            );
          }

          if (paginationResult.batchRunIds.length === 0) {
            return { runs: [], nextCursor: undefined, hasMore: false };
          }

          const runs = await this.clickHouseService.getRunDataForBatchIds({
            projectId,
            batchRunIds: paginationResult.batchRunIds,
          });
          if (runs === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getRunDataForBatchIds — check ClickHouse client configuration",
            );
          }

          return {
            runs,
            nextCursor: paginationResult.nextCursor,
            hasMore: paginationResult.hasMore,
          };
        }

        return this.esService.getRunDataForScenarioSet({
          projectId,
          scenarioSetId,
          limit,
          cursor,
        });
      },
    );
  }

  async getAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    return tracer.withActiveSpan(
      "SimulationService.getAllRunDataForScenarioSet",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          // Paginate through all batch run IDs, then fetch all runs
          const allBatchRunIds: string[] = [];
          let cursor: string | undefined = undefined;
          const pageLimit = 100;
          const maxPages = 200;

          for (let i = 0; i < maxPages; i++) {
            const page =
              await this.clickHouseService.getBatchRunIdsForScenarioSet({
                projectId,
                scenarioSetId,
                limit: pageLimit,
                cursor,
              });
            if (page === null) {
              throw new Error(
                "ClickHouse is enabled but returned null for getBatchRunIdsForScenarioSet — check ClickHouse client configuration",
              );
            }

            if (page.batchRunIds.length === 0) break;
            allBatchRunIds.push(...page.batchRunIds);

            if (!page.nextCursor || page.nextCursor === cursor) break;
            if (i === maxPages - 1 && page.nextCursor) {
              throw new Error(
                `Too many runs to fetch exhaustively (cap ${maxPages * pageLimit}). ` +
                  "Refine filters or use the paginated API.",
              );
            }
            cursor = page.nextCursor;
          }

          if (allBatchRunIds.length === 0) return [];

          const runs = await this.clickHouseService.getRunDataForBatchIds({
            projectId,
            batchRunIds: allBatchRunIds,
          });
          if (runs === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getRunDataForBatchIds — check ClickHouse client configuration",
            );
          }

          return runs;
        }

        return this.esService.getAllRunDataForScenarioSet({
          projectId,
          scenarioSetId,
        });
      },
    );
  }

  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
  }): Promise<ScenarioRunData[]> {
    return tracer.withActiveSpan(
      "SimulationService.getRunDataForBatchRun",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
          "batch.run.id": batchRunId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getRunDataForBatchRun({
              projectId,
              batchRunId,
            });
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getRunDataForBatchRun — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.esService.getRunDataForBatchRun({
          projectId,
          scenarioSetId,
          batchRunId,
        });
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
      "SimulationService.getScenarioRunData",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          // getScenarioRunData returns null for both "CH unavailable" and "not found"
          // but since we already confirmed CH is enabled, null means "not found"
          return this.clickHouseService.getScenarioRunData({
            projectId,
            scenarioRunId,
          });
        }

        return this.esService.getScenarioRunData({
          projectId,
          scenarioRunId,
        });
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
      "SimulationService.getScenarioRunDataByScenarioId",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.id": scenarioId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getScenarioRunDataByScenarioId({
              projectId,
              scenarioId,
            });
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getScenarioRunDataByScenarioId — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.esService.getScenarioRunDataByScenarioId({
          projectId,
          scenarioId,
        });
      },
    );
  }

  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number> {
    return tracer.withActiveSpan(
      "SimulationService.getBatchRunCountForScenarioSet",
      {
        attributes: {
          "tenant.id": projectId,
          "scenario.set.id": scenarioSetId,
        },
      },
      async (span) => {
        const useClickHouse =
          await this.clickHouseService.isClickHouseEnabled(projectId);
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result =
            await this.clickHouseService.getBatchRunCountForScenarioSet({
              projectId,
              scenarioSetId,
            });
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getBatchRunCountForScenarioSet — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.esService.getBatchRunCountForScenarioSet({
          projectId,
          scenarioSetId,
        });
      },
    );
  }
}
