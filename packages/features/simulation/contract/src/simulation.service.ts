import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExportRun,
  SimulationAllSuitesRunData,
  SimulationExternalSetSummary,
  SimulationRunData,
  SimulationSetData,
} from "./simulation";
import type {
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "./simulation.commands";

/** Shared Simulation read capability. Transports depend on this, never a repository. */
export abstract class SimulationService {
  abstract getScenarioSetsData(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationSetData[]>;
  abstract tryGetScenarioRunData(input: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<SimulationRunData | null>;
  abstract getBatchHistoryForScenarioSet(input: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationBatchHistory>;
  abstract tryGetBatchSummary(input: {
    projectId: string;
    batchRunId: string;
  }): Promise<SimulationBatchSummary | null>;
  abstract getRunDataForBatchRun(input: {
    projectId: string;
    scenarioSetId?: string;
    batchRunId: string;
    sinceTimestamp?: number;
  }): Promise<SimulationBatchRunData>;
  abstract getRunDataForScenarioSet(input: {
    projectId: string;
    scenarioSetId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
  abstract getAllRunDataForScenarioSet(input: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<SimulationRunData[]>;
  abstract getBatchRunCountForScenarioSet(input: {
    projectId: string;
    scenarioSetId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;
  abstract getExternalSetSummaries(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]>;
  abstract getInternalSuiteSummaries(input: {
    projectId: string;
    startDate?: number;
    endDate?: number;
  }): Promise<SimulationExternalSetSummary[]>;
  abstract getRunDataForAllSuites(input: {
    projectId: string;
    limit?: number;
    cursor?: string;
    startDate?: number;
    endDate?: number;
    sinceTimestamp?: number;
  }): Promise<SimulationAllSuitesRunData>;
  abstract getLastUpdatedAt(input: {
    projectId: string;
    scenarioSetId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;
  abstract getRunIdsForSet(input: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract getDistinctExternalSetIds(input: {
    projectIds: string[];
  }): Promise<Set<string>>;
  abstract countRunsForExport(input: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
  }): Promise<number>;
  abstract findRunsForExport(input: {
    projectId: string;
    scenarioSetId?: string;
    scenarioId?: string;
    startDate?: number;
    endDate?: number;
    limit: number;
    cursor?: string;
  }): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }>;
  abstract queueRun(input: SimulationQueueRun): Promise<void>;
  abstract startRun(input: SimulationStartRun): Promise<void>;
  abstract messageSnapshot(input: SimulationMessageSnapshot): Promise<void>;
  abstract textMessageStart(input: SimulationTextMessageStart): Promise<void>;
  abstract textMessageEnd(input: SimulationTextMessageEnd): Promise<void>;
  abstract finishRun(input: SimulationFinishRun): Promise<void>;
  abstract cancelRun(input: SimulationCancelRun): Promise<void>;
  abstract deleteRun(input: SimulationDeleteRun): Promise<void>;
}
