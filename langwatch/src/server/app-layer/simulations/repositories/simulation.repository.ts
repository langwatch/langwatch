import type {
  BatchHistoryResult,
  BatchRunDataResult,
  ExternalSetSummary,
  ScenarioRunData,
  ScenarioSetData,
} from "~/server/scenarios/scenario-event.types";

export type AllSuitesRunDataResult =
  | { changed: false; lastUpdatedAt: number }
  | {
      changed: true;
      lastUpdatedAt: number;
      runs: ScenarioRunData[];
      scenarioSetIds: Record<string, string>;
      nextCursor?: string;
      hasMore: boolean;
    };

export interface SimulationRepository {
  getScenarioSetsData(params: {
    projectId: string;
  }): Promise<ScenarioSetData[]>;

  getScenarioRunData(params: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunData | null>;

  getBatchHistoryForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
  }): Promise<BatchHistoryResult>;

  getRunDataForBatchRun(params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<BatchRunDataResult>;

  getRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{ runs: ScenarioRunData[]; nextCursor?: string; hasMore: boolean }>;

  getAllRunDataForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<ScenarioRunData[]>;

  getScenarioRunDataByScenarioId(params: {
    projectId: string;
    scenarioId: string;
  }): Promise<ScenarioRunData[] | null>;

  getBatchRunCountForScenarioSet(params: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number>;

  getExternalSetSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]>;

  getInternalSuiteSummaries(params: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<ExternalSetSummary[]>;

  getRunDataForAllSuites(params: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }): Promise<AllSuitesRunDataResult>;

  getAllRunIdsForProject(params: {
    projectId: string;
  }): Promise<string[]>;

  /**
   * Returns distinct external (non-internal) scenario set IDs across the given projects.
   * Used for cross-org counting of scenario sets for limit enforcement.
   */
  getDistinctExternalSetIds(params: {
    projectIds: string[];
  }): Promise<Set<string>>;
}

export class NullSimulationRepository implements SimulationRepository {
  async getScenarioSetsData(): Promise<ScenarioSetData[]> {
    return [];
  }

  async getScenarioRunData(): Promise<ScenarioRunData | null> {
    return null;
  }

  async getBatchHistoryForScenarioSet(): Promise<BatchHistoryResult> {
    return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
  }

  async getRunDataForBatchRun(): Promise<BatchRunDataResult> {
    return { changed: true, lastUpdatedAt: 0, runs: [] };
  }

  async getRunDataForScenarioSet(): Promise<{ runs: ScenarioRunData[]; nextCursor?: string; hasMore: boolean }> {
    return { runs: [], hasMore: false };
  }

  async getAllRunDataForScenarioSet(): Promise<ScenarioRunData[]> {
    return [];
  }

  async getScenarioRunDataByScenarioId(): Promise<ScenarioRunData[] | null> {
    return null;
  }

  async getBatchRunCountForScenarioSet(): Promise<number> {
    return 0;
  }

  async getExternalSetSummaries(): Promise<ExternalSetSummary[]> {
    return [];
  }

  async getInternalSuiteSummaries(): Promise<ExternalSetSummary[]> {
    return [];
  }

  async getRunDataForAllSuites(): Promise<AllSuitesRunDataResult> {
    return { changed: true, lastUpdatedAt: 0, runs: [], scenarioSetIds: {}, hasMore: false };
  }

  async getAllRunIdsForProject(): Promise<string[]> {
    return [];
  }

  async getDistinctExternalSetIds(): Promise<Set<string>> {
    return new Set();
  }
}
