import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExportRun,
  SimulationAllSuitesRunData,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
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

export type SimulationProjectDateRangeInput = {
  projectId: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationScenarioRunInput = {
  projectId: string;
  scenarioRunId: string;
};

export type SimulationBatchHistoryInput = {
  projectId: string;
  scenarioSetId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationBatchSummaryInput = {
  projectId: string;
  batchRunId: string;
};

export type SimulationBatchRunInput = {
  projectId: string;
  scenarioSetId?: string;
  batchRunId: string;
  sinceTimestamp?: number;
};

export type SimulationScenarioSetRunsInput = {
  projectId: string;
  scenarioSetId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationScenarioSetInput = {
  projectId: string;
  scenarioSetId: string;
};

export type SimulationExternalSetCountInput = {
  projectId: string;
  scenarioSetId: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationAllSuitesInput = {
  projectId: string;
  limit?: number;
  cursor?: string;
  startDate?: number;
  endDate?: number;
  sinceTimestamp?: number;
};

export type SimulationLastUpdatedInput = {
  projectId: string;
  scenarioSetId?: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationLastResultSummariesInput = SimulationProjectDateRangeInput & {
  scenarioIds?: string[];
};

export type SimulationProjectIdsInput = {
  projectIds: string[];
};

export type SimulationExportFilterInput = {
  projectId: string;
  scenarioSetId?: string;
  scenarioId?: string;
  startDate?: number;
  endDate?: number;
};

export type SimulationExportRunsInput = SimulationExportFilterInput & {
  limit: number;
  cursor?: string;
};

/** Shared Simulation read capability. Transports depend on this, never a repository. */
export abstract class SimulationService {
  abstract getScenarioSetsData(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationSetData[]>;
  abstract tryGetScenarioRunData(
    input: SimulationScenarioRunInput,
  ): Promise<SimulationRunData | null>;
  abstract getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory>;
  abstract tryGetBatchSummary(
    input: SimulationBatchSummaryInput,
  ): Promise<SimulationBatchSummary | null>;
  abstract getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData>;
  abstract getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
  abstract getAllRunDataForScenarioSet(
    input: SimulationScenarioSetInput,
  ): Promise<SimulationRunData[]>;
  abstract getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number>;
  abstract getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  abstract getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  abstract getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]>;
  abstract getRunDataForAllSuites(
    input: SimulationAllSuitesInput,
  ): Promise<SimulationAllSuitesRunData>;
  abstract getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number>;
  abstract getRunIdsForSet(
    input: SimulationScenarioSetInput,
  ): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract getDistinctExternalSetIds(input: SimulationProjectIdsInput): Promise<Set<string>>;
  abstract countRunsForExport(input: SimulationExportFilterInput): Promise<number>;
  abstract findRunsForExport(
    input: SimulationExportRunsInput,
  ): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }>;
  abstract queueRun(input: SimulationQueueRun): Promise<void>;
  abstract startRun(input: SimulationStartRun): Promise<void>;
  abstract messageSnapshot(input: SimulationMessageSnapshot): Promise<void>;
  abstract textMessageStart(input: SimulationTextMessageStart): Promise<void>;
  abstract textMessageEnd(input: SimulationTextMessageEnd): Promise<void>;
  abstract finishRun(input: SimulationFinishRun): Promise<void>;
  abstract cancelRun(input: SimulationCancelRun): Promise<void>;
  abstract deleteRun(input: SimulationDeleteRun): Promise<void>;
}
