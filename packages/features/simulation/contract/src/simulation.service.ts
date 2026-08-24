import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationAllSuitesRunData,
  SimulationExternalSetSummary,
  SimulationRunData,
  SimulationSetData,
} from "./simulation";

/** Shared Simulation read capability. Transports depend on this, never a repository. */
export abstract class SimulationService {
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
  abstract getRunDataForAllSuites(input: { projectId: string; limit?: number; cursor?: string; startDate?: number; endDate?: number; sinceTimestamp?: number }): Promise<SimulationAllSuitesRunData>;
  abstract getLastUpdatedAt(input: { projectId: string; scenarioSetId?: string; startDate?: number; endDate?: number }): Promise<number>;
  abstract getRunIdsForSet(input: { projectId: string; scenarioSetId: string }): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract getDistinctExternalSetIds(input: { projectIds: string[] }): Promise<Set<string>>;
}
