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

  private async routeToBackend<T>({
    spanName,
    attributes,
    projectId,
    chFn,
    esFn,
  }: {
    spanName: string;
    attributes: Record<string, string>;
    projectId: string;
    chFn: () => Promise<T | null>;
    esFn: () => Promise<T>;
  }): Promise<T> {
    return tracer.withActiveSpan(spanName, { attributes }, async (span) => {
      const useClickHouse =
        await this.clickHouseService.isClickHouseEnabled(projectId);
      span.setAttribute(
        "backend",
        useClickHouse ? "clickhouse" : "elasticsearch",
      );

      if (useClickHouse) {
        const result = await chFn();
        if (result === null) {
          throw new Error(
            `ClickHouse is enabled but returned null for ${spanName} — check ClickHouse client configuration`,
          );
        }
        return result;
      }

      return esFn();
    });
  }

  private requireResult<T>(result: T | null, methodName: string): T {
    if (result === null) {
      throw new Error(
        `ClickHouse is enabled but returned null for ${methodName} — check ClickHouse client configuration`,
      );
    }
    return result;
  }

  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ScenarioSetData[]> {
    return this.routeToBackend({
      spanName: "SimulationService.getScenarioSetsDataForProject",
      attributes: { "tenant.id": projectId },
      projectId,
      chFn: () => this.clickHouseService.getScenarioSetsData({ projectId }),
      esFn: () =>
        this.esService.getScenarioSetsDataForProject({ projectId }),
    });
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
    const validatedLimit = Math.min(Math.max(1, limit), 100);

    return this.routeToBackend({
      spanName: "SimulationService.getRunDataForScenarioSet",
      attributes: {
        "tenant.id": projectId,
        "scenario.set.id": scenarioSetId,
      },
      projectId,
      chFn: async () => {
        const paginationResult = this.requireResult(
          await this.clickHouseService.getBatchRunIdsForScenarioSet({
            projectId,
            scenarioSetId,
            limit: validatedLimit,
            cursor,
          }),
          "getBatchRunIdsForScenarioSet",
        );

        if (paginationResult.batchRunIds.length === 0) {
          return { runs: [], nextCursor: undefined, hasMore: false };
        }

        const runs = this.requireResult(
          await this.clickHouseService.getRunDataForBatchIds({
            projectId,
            batchRunIds: paginationResult.batchRunIds,
          }),
          "getRunDataForBatchIds",
        );

        return {
          runs,
          nextCursor: paginationResult.nextCursor,
          hasMore: paginationResult.hasMore,
        };
      },
      esFn: () =>
        this.esService.getRunDataForScenarioSet({
          projectId,
          scenarioSetId,
          limit: validatedLimit,
          cursor,
        }),
    });
  }

  async getAllRunDataForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    return this.routeToBackend({
      spanName: "SimulationService.getAllRunDataForScenarioSet",
      attributes: {
        "tenant.id": projectId,
        "scenario.set.id": scenarioSetId,
      },
      projectId,
      chFn: async () => {
        // Paginate through all batch run IDs, then fetch all runs
        const allBatchRunIds: string[] = [];
        let cursor: string | undefined = undefined;
        const pageLimit = 100;
        const maxPages = 200;

        for (let i = 0; i < maxPages; i++) {
          const page: {
            batchRunIds: string[];
            nextCursor: string | undefined;
            hasMore: boolean;
          } = this.requireResult(
            await this.clickHouseService.getBatchRunIdsForScenarioSet({
              projectId,
              scenarioSetId,
              limit: pageLimit,
              cursor,
            }),
            "getBatchRunIdsForScenarioSet",
          );

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

        return this.requireResult(
          await this.clickHouseService.getRunDataForBatchIds({
            projectId,
            batchRunIds: allBatchRunIds,
          }),
          "getRunDataForBatchIds",
        );
      },
      esFn: () =>
        this.esService.getAllRunDataForScenarioSet({
          projectId,
          scenarioSetId,
        }),
    });
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
    return this.routeToBackend({
      spanName: "SimulationService.getRunDataForBatchRun",
      attributes: {
        "tenant.id": projectId,
        "scenario.set.id": scenarioSetId,
        "batch.run.id": batchRunId,
      },
      projectId,
      chFn: () =>
        this.clickHouseService.getRunDataForBatchRun({
          projectId,
          batchRunId,
        }),
      esFn: () =>
        this.esService.getRunDataForBatchRun({
          projectId,
          scenarioSetId,
          batchRunId,
        }),
    });
  }

  /**
   * Fetch a single scenario run by its ID.
   *
   * Unlike other methods, this intentionally returns `null` (not throws) when
   * the ClickHouse backend is enabled but the run is not found.
   *
   * @returns null when the run is not found
   */
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
          return this.clickHouseService.getScenarioRunDataByScenarioId({
            projectId,
            scenarioId,
          });
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
    return this.routeToBackend({
      spanName: "SimulationService.getBatchRunCountForScenarioSet",
      attributes: {
        "tenant.id": projectId,
        "scenario.set.id": scenarioSetId,
      },
      projectId,
      chFn: () =>
        this.clickHouseService.getBatchRunCountForScenarioSet({
          projectId,
          scenarioSetId,
        }),
      esFn: () =>
        this.esService.getBatchRunCountForScenarioSet({
          projectId,
          scenarioSetId,
        }),
    });
  }
}
