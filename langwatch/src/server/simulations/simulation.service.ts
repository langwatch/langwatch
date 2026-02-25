import type { PrismaClient } from "@prisma/client";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import { ScenarioEventService } from "../scenarios/scenario-event.service";
import type { ScenarioEvent } from "../scenarios/scenario-event.types";
import { ClickHouseSimulationService } from "./clickhouse-simulation.service";
import type { BatchHistoryResult, BatchRunDataResult } from "../scenarios/scenario-event.types";

const logger = createLogger("langwatch:simulations:service");

/**
 * Facade that delegates simulation reads to either ClickHouse or Elasticsearch
 * based on the `featureClickHouseDataSourceSimulations` project flag.
 *
 * Write operations still go through the ScenarioEventService (ES path)
 * because dual-write is handled at the route handler layer.
 *
 * Return types intentionally match ScenarioEventService so tRPC router
 * shapes are unchanged.
 */
export class SimulationService {
  private readonly esService: ScenarioEventService;
  private readonly chService: ClickHouseSimulationService | null;

  constructor(private readonly prisma: PrismaClient) {
    this.esService = new ScenarioEventService();
    this.chService = ClickHouseSimulationService.create(getClickHouseClient());
  }

  static create(prisma: PrismaClient = defaultPrisma): SimulationService {
    return new SimulationService(prisma);
  }

  private async isClickHouseEnabled(projectId: string): Promise<boolean> {
    if (!this.chService) return false;

    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { featureClickHouseDataSourceSimulations: true },
    });
    return project?.featureClickHouseDataSourceSimulations ?? false;
  }

  // ---- Read methods ----

  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }) {
    if (await this.isClickHouseEnabled(projectId)) {
      return this.chService!.getScenarioSetsData({ projectId });
    }
    return this.esService.getScenarioSetsDataForProject({ projectId });
  }

  async getScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }) {
    if (await this.isClickHouseEnabled(projectId)) {
      return this.chService!.getScenarioRunData({ projectId, scenarioRunId });
    }
    return this.esService.getScenarioRunData({ projectId, scenarioRunId });
  }

  async getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BatchHistoryResult> {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getBatchHistoryForScenarioSet(params);
    }
    return this.esService.getBatchHistoryForScenarioSet(params);
  }

  async getRunDataForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
    sinceTimestamp,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult> {
    if (await this.isClickHouseEnabled(projectId)) {
      return this.chService!.getRunDataForBatchRun({
        projectId,
        scenarioSetId,
        batchRunId,
        sinceTimestamp,
      });
    }
    return this.esService.getRunDataForBatchRun({
      projectId,
      scenarioSetId,
      batchRunId,
      sinceTimestamp,
    });
  }

  async getRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }) {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getRunDataForScenarioSet(params);
    }
    return this.esService.getRunDataForScenarioSet(params);
  }

  async getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }) {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getAllRunDataForScenarioSet(params);
    }
    return this.esService.getAllRunDataForScenarioSet(params);
  }

  async getScenarioRunDataByScenarioId(params: {
    projectId: string;
    scenarioId: string;
  }) {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getScenarioRunDataByScenarioId(params);
    }
    return this.esService.getScenarioRunDataByScenarioId(params);
  }

  async getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }) {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getBatchRunCountForScenarioSet(params);
    }
    return this.esService.getBatchRunCountForScenarioSet(params);
  }

  async getRunDataForAllSuites(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }) {
    if (await this.isClickHouseEnabled(params.projectId)) {
      return this.chService!.getRunDataForAllSuites(params);
    }
    return this.esService.getRunDataForAllSuites(params);
  }

  // ---- Write / delete methods ----

  async deleteAllEventsForProject({
    projectId,
  }: {
    projectId: string;
  }) {
    // Always delete from ES
    await this.esService.deleteAllEventsForProject({ projectId });

    // Also soft-delete in CH if available
    if (this.chService) {
      try {
        await this.chService.softDeleteAllForProject({ projectId });
      } catch (error) {
        logger.warn(
          { error, projectId },
          "Failed to soft-delete simulation runs in ClickHouse",
        );
      }
    }
  }

  async saveScenarioEvent(params: ScenarioEvent & { projectId: string }) {
    return this.esService.saveScenarioEvent(params);
  }
}
