import type {
  SimulationBatchHistory as BatchHistoryResult,
  SimulationBatchRunData as BatchRunDataResult,
  SimulationBatchSummary as BatchSummary,
  SimulationExternalSetSummary as ExternalSetSummary,
  SimulationLastResultSummary as ScenarioLastResultSummary,
  SimulationRunData as ScenarioRunData,
  SimulationSetData as ScenarioSetData,
} from "@langwatch/simulation-contract";
import type { SimulationRepository } from "./repositories/simulation.repository";

export class SimulationRunService {
  constructor(readonly repository: SimulationRepository) {}

  async getScenarioSetsData(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ScenarioSetData[]> {
    return this.repository.getScenarioSetsData(params);
  }

  async getScenarioRunData(params: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunData | null> {
    return this.repository.getScenarioRunData(params);
  }

  async getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<BatchHistoryResult> {
    return this.repository.getBatchHistoryForScenarioSet(params);
  }

  async getBatchSummary(params: {
    projectId: string;
    batchRunId: string;
  }): Promise<BatchSummary | null> {
    return this.repository.getBatchSummary(params);
  }

  async getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId?: string;
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
  }): Promise<{
    runs: ScenarioRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return this.repository.getRunDataForScenarioSet(params);
  }

  async getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]> {
    return this.repository.getAllRunDataForScenarioSet(params);
  }

  async getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    return this.repository.getBatchRunCountForScenarioSet(params);
  }

  async getExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]> {
    return this.repository.getExternalSetSummaries(params);
  }

  async getInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]> {
    return this.repository.getInternalSuiteSummaries(params);
  }

  /**
   * The latest run result per scenario inside the window, for the last-result
   * cells of the test cases table. Kept separate from the scenario list read
   * so the list renders instantly and the cells stream in.
   */
  async getLastResultSummaries(params: {
    projectId: string;
    scenarioIds?: string[];
    startDate?: number;
    endDate?: number;
  }): Promise<ScenarioLastResultSummary[]> {
    return this.repository.getLastResultSummaries(params);
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

  /**
   * Cheap freshness signal for the run history views: the latest UpdatedAt
   * (Unix ms) across the project's runs in the given window. The UI polls
   * this instead of re-downloading run payloads, and only re-fetches the
   * heavy run data when the value advances.
   */
  async getLastUpdatedAt(params: {
    projectId: string;
    scenarioSetId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number> {
    return this.repository.findLastUpdatedAt(params);
  }

  async getRunIdsForSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }> {
    return this.repository.findAllRunIdsForSet(params);
  }

  /**
   * Returns distinct external (non-internal) scenario set IDs across the given projects.
   * Used by UsageService for cross-org scenario set limit enforcement.
   */
  async getDistinctExternalSetIds(params: { projectIds: string[] }): Promise<Set<string>> {
    return this.repository.getDistinctExternalSetIds(params);
  }
}
