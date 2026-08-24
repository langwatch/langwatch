import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExportRun,
  SimulationExternalSetSummary,
  SimulationRunData,
  SimulationSetData,
} from "@langwatch/simulation-contract";

/** A run carrying the stored columns an export needs beyond the display model. */
export type AllSimulationSuitesRunData =
  | { changed: false; lastUpdatedAt: number }
  | {
      changed: true;
      lastUpdatedAt: number;
      runs: SimulationRunData[];
      scenarioSetIds: Record<string, string>;
      nextCursor?: string;
      hasMore: boolean;
    };

/** Simulation's own persistence port. No consumer receives this through App. */
export abstract class SimulationRepository {
  abstract getScenarioSetsData(input: { projectId: string; startDate?: number; endDate?: number }): Promise<SimulationSetData[]>;
  abstract tryGetScenarioRunData(input: { projectId: string; scenarioRunId: string }): Promise<SimulationRunData | null>;
  abstract getBatchHistoryForScenarioSet(input: { projectId: string; scenarioSetId: string; limit?: number; cursor?: string; startDate?: number; endDate?: number }): Promise<SimulationBatchHistory>;
  abstract tryGetBatchSummary(input: { projectId: string; batchRunId: string }): Promise<SimulationBatchSummary | null>;
  abstract getRunDataForBatchRun(input: { projectId: string; scenarioSetId?: string; batchRunId: string; sinceTimestamp?: number }): Promise<SimulationBatchRunData>;
  abstract getRunDataForScenarioSet(input: { projectId: string; scenarioSetId: string; limit?: number; cursor?: string; startDate?: number; endDate?: number }): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
  abstract getAllRunDataForScenarioSet(input: { projectId: string; scenarioSetId: string }): Promise<SimulationRunData[]>;
  abstract getBatchRunCountForScenarioSet(input: { projectId: string; scenarioSetId: string; startDate?: number; endDate?: number }): Promise<number>;
  abstract getExternalSetSummaries(input: { projectId: string; startDate?: number; endDate?: number }): Promise<SimulationExternalSetSummary[]>;
  abstract getInternalSuiteSummaries(input: { projectId: string; startDate?: number; endDate?: number }): Promise<SimulationExternalSetSummary[]>;
  abstract getRunDataForAllSuites(input: { projectId: string; limit?: number; cursor?: string; startDate?: number; endDate?: number; sinceTimestamp?: number }): Promise<AllSimulationSuitesRunData>;
  abstract findLastUpdatedAt(input: { projectId: string; scenarioSetId?: string; startDate?: number; endDate?: number }): Promise<number>;
  abstract findAllRunIdsForSet(input: { projectId: string; scenarioSetId: string }): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract getDistinctExternalSetIds(input: { projectIds: string[] }): Promise<Set<string>>;
  abstract countRunsForExport(input: { projectId: string; scenarioSetId?: string; scenarioId?: string; startDate?: number; endDate?: number }): Promise<number>;
  abstract findRunsForExport(input: { projectId: string; scenarioSetId?: string; scenarioId?: string; startDate?: number; endDate?: number; limit: number; cursor?: string }): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }>;
}

/** Deliberate disabled-store implementation for local and test composition. */
export class NullSimulationRepository extends SimulationRepository {
  async getScenarioSetsData(): Promise<SimulationSetData[]> { return []; }
  async tryGetScenarioRunData(): Promise<SimulationRunData | null> { return null; }
  async getBatchHistoryForScenarioSet(): Promise<SimulationBatchHistory> { return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 }; }
  async tryGetBatchSummary(): Promise<SimulationBatchSummary | null> { return null; }
  async getRunDataForBatchRun(): Promise<SimulationBatchRunData> { return { changed: true, lastUpdatedAt: 0, runs: [] }; }
  async getRunDataForScenarioSet(): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> { return { runs: [], hasMore: false }; }
  async getAllRunDataForScenarioSet(): Promise<SimulationRunData[]> { return []; }
  async getBatchRunCountForScenarioSet(): Promise<number> { return 0; }
  async getExternalSetSummaries(): Promise<SimulationExternalSetSummary[]> { return []; }
  async getInternalSuiteSummaries(): Promise<SimulationExternalSetSummary[]> { return []; }
  async getRunDataForAllSuites(): Promise<AllSimulationSuitesRunData> { return { changed: true, lastUpdatedAt: 0, runs: [], scenarioSetIds: {}, hasMore: false }; }
  async findLastUpdatedAt(): Promise<number> { return 0; }
  async findAllRunIdsForSet(): Promise<{ runIds: string[]; reachedCap: boolean }> { return { runIds: [], reachedCap: false }; }
  async getDistinctExternalSetIds(): Promise<Set<string>> { return new Set(); }
  async countRunsForExport(): Promise<number> { return 0; }
  async findRunsForExport(): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }> { return { runs: [], hasMore: false }; }
}
