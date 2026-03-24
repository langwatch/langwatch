import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import type {
  BatchHistoryResult,
  BatchRunDataResult,
  ExternalSetSummary,
  ScenarioRunData,
  ScenarioSetData,
} from "~/server/scenarios/scenario-event.types";
import { traced } from "../tracing";
import { SimulationClickHouseRepository } from "./repositories/simulation.clickhouse.repository";
import {
  NullSimulationRepository,
  type SimulationRepository,
} from "./repositories/simulation.repository";

export class SimulationRunService {
  constructor(readonly repository: SimulationRepository) {}

  static create(resolveClient: ClickHouseClientResolver | null): SimulationRunService {
    const repo = resolveClient
      ? new SimulationClickHouseRepository(resolveClient)
      : new NullSimulationRepository();
    return traced(new SimulationRunService(repo), "SimulationRunService");
  }

  async getScenarioSetsData(params: { projectId: string }): Promise<ScenarioSetData[]> {
    return this.repository.getScenarioSetsData(params);
  }

  async getScenarioRunData(params: { projectId: string; scenarioRunId: string }): Promise<ScenarioRunData | null> {
    return this.repository.getScenarioRunData(params);
  }

  async getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BatchHistoryResult> {
    return this.repository.getBatchHistoryForScenarioSet(params);
  }

  async getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult> {
    return this.repository.getRunDataForBatchRun(params);
  }

  async getRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{ runs: ScenarioRunData[]; nextCursor?: string; hasMore: boolean }> {
    return this.repository.getRunDataForScenarioSet(params);
  }

  async getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    return this.repository.getAllRunDataForScenarioSet(params);
  }

  async getScenarioRunDataByScenarioId(params: {
    projectId: string;
    scenarioId: string;
  }): Promise<ScenarioRunData[] | null> {
    return this.repository.getScenarioRunDataByScenarioId(params);
  }

  async getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number> {
    return this.repository.getBatchRunCountForScenarioSet(params);
  }

  async getExternalSetSummaries(params: { projectId: string; startDate?: number; endDate?: number }): Promise<ExternalSetSummary[]> {
    return this.repository.getExternalSetSummaries(params);
  }

  async getRunDataForAllSuites(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }) {
    return this.repository.getRunDataForAllSuites(params);
  }

  async getAllRunIdsForProject(params: { projectId: string }): Promise<string[]> {
    return this.repository.getAllRunIdsForProject(params);
  }

  /**
   * Returns distinct external (non-internal) scenario set IDs across the given projects.
   * Used by UsageService for cross-org scenario set limit enforcement.
   */
  async getDistinctExternalSetIds(params: { projectIds: string[] }): Promise<Set<string>> {
    return this.repository.getDistinctExternalSetIds(params);
  }
}
