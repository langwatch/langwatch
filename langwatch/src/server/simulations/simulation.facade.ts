import { getApp } from "~/server/app-layer/app";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import type { SimulationRunService } from "~/server/app-layer/simulations/simulation-run.service";
import { ScenarioEventService } from "../scenarios/scenario-event.service";
import type { BatchHistoryResult, BatchRunDataResult, ScenarioEvent } from "../scenarios/scenario-event.types";

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
export class SimulationFacade {
  constructor(
    private readonly deps: {
      projects: ProjectService;
      chService: SimulationRunService | null;
      esService: ScenarioEventService;
    },
  ) {}

  static create(): SimulationFacade {
    const app = getApp();
    return new SimulationFacade({
      projects: app.projects,
      chService: app.simulations.runs ?? null,
      esService: new ScenarioEventService(),
    });
  }

  async isClickHouseReadEnabled(projectId: string): Promise<boolean> {
    if (!this.deps.chService) return false;
    return this.deps.projects.isFeatureEnabled(projectId, "featureClickHouseDataSourceSimulations");
  }

  /**
   * Routes a read operation to ClickHouse or Elasticsearch based on the
   * project feature flag. Since `isClickHouseEnabled` already returns false
   * when `chService` is null, the non-null assertion on `chService` is safe
   * inside the truthy branch.
   */
  private async routeRead<T>({
    projectId,
    chCall,
    esCall,
  }: {
    projectId: string;
    chCall: (ch: SimulationRunService) => Promise<T>;
    esCall: () => Promise<T>;
  }): Promise<T> {
    if (await this.isClickHouseReadEnabled(projectId)) {
      return chCall(this.deps.chService!);
    }
    return esCall();
  }

  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }) {
    return this.routeRead({
      projectId,
      chCall: (ch) => ch.getScenarioSetsData({ projectId }),
      esCall: () => this.deps.esService.getScenarioSetsDataForProject({ projectId }),
    });
  }

  async getScenarioRunData({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }) {
    return this.routeRead({
      projectId,
      chCall: (ch) => ch.getScenarioRunData({ projectId, scenarioRunId }),
      esCall: () => this.deps.esService.getScenarioRunData({ projectId, scenarioRunId }),
    });
  }

  async getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BatchHistoryResult> {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getBatchHistoryForScenarioSet(params),
      esCall: () => this.deps.esService.getBatchHistoryForScenarioSet(params),
    });
  }

  async getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult> {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getRunDataForBatchRun(params),
      esCall: () => this.deps.esService.getRunDataForBatchRun(params),
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
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getRunDataForScenarioSet(params),
      esCall: () => this.deps.esService.getRunDataForScenarioSet(params),
    });
  }

  async getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }) {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getAllRunDataForScenarioSet(params),
      esCall: () => this.deps.esService.getAllRunDataForScenarioSet(params),
    });
  }

  async getScenarioRunDataByScenarioId(params: {
    projectId: string;
    scenarioId: string;
  }) {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getScenarioRunDataByScenarioId(params),
      esCall: () => this.deps.esService.getScenarioRunDataByScenarioId(params),
    });
  }

  async getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }) {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getBatchRunCountForScenarioSet(params),
      esCall: () => this.deps.esService.getBatchRunCountForScenarioSet(params),
    });
  }

  async getExternalSetSummaries(params: {
    projectId: string;
  }) {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getExternalSetSummaries(params),
      esCall: () => this.deps.esService.getExternalSetSummaries(params),
    });
  }

  async getRunDataForAllSuites(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }) {
    return this.routeRead({
      projectId: params.projectId,
      chCall: (ch) => ch.getRunDataForAllSuites(params),
      esCall: () => this.deps.esService.getRunDataForAllSuites(params),
    });
  }

  async saveScenarioEvent(params: ScenarioEvent & { projectId: string }) {
    return this.deps.esService.saveScenarioEvent(params);
  }
}
