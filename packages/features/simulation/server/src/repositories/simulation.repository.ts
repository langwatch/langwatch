import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExportRun,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationRunData,
  SimulationSetData,
} from "@langwatch/simulation-contract";
import type {
  SimulationAllSuitesInput,
  SimulationBatchHistoryInput,
  SimulationBatchRunInput,
  SimulationBatchSummaryInput,
  SimulationExportFilterInput,
  SimulationExportRunsInput,
  SimulationExternalSetCountInput,
  SimulationLastUpdatedInput,
  SimulationLastResultSummariesInput,
  SimulationProjectDateRangeInput,
  SimulationProjectIdsInput,
  SimulationScenarioRunInput,
  SimulationScenarioSetInput,
  SimulationScenarioSetRunsInput,
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
  ): Promise<AllSimulationSuitesRunData>;
  abstract findLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number>;
  abstract findAllRunIdsForSet(
    input: SimulationScenarioSetInput,
  ): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract getDistinctExternalSetIds(input: SimulationProjectIdsInput): Promise<Set<string>>;
  abstract countRunsForExport(input: SimulationExportFilterInput): Promise<number>;
  abstract findRunsForExport(
    input: SimulationExportRunsInput,
  ): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }>;
}

/** Deliberate disabled-store implementation for local and test composition. */
export class NullSimulationRepository extends SimulationRepository {
  async getScenarioSetsData(): Promise<SimulationSetData[]> {
    return [];
  }
  async tryGetScenarioRunData(): Promise<SimulationRunData | null> {
    return null;
  }
  async getBatchHistoryForScenarioSet(): Promise<SimulationBatchHistory> {
    return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
  }
  async tryGetBatchSummary(): Promise<SimulationBatchSummary | null> {
    return null;
  }
  async getRunDataForBatchRun(): Promise<SimulationBatchRunData> {
    return { changed: true, lastUpdatedAt: 0, runs: [] };
  }
  async getRunDataForScenarioSet(): Promise<{
    runs: SimulationRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: [], hasMore: false };
  }
  async getAllRunDataForScenarioSet(): Promise<SimulationRunData[]> {
    return [];
  }
  async getBatchRunCountForScenarioSet(): Promise<number> {
    return 0;
  }
  async getExternalSetSummaries(): Promise<SimulationExternalSetSummary[]> {
    return [];
  }
  async getInternalSuiteSummaries(): Promise<SimulationExternalSetSummary[]> {
    return [];
  }
  async getLastResultSummaries(): Promise<SimulationLastResultSummary[]> {
    return [];
  }
  async getRunDataForAllSuites(): Promise<AllSimulationSuitesRunData> {
    return {
      changed: true,
      lastUpdatedAt: 0,
      runs: [],
      scenarioSetIds: {},
      hasMore: false,
    };
  }
  async findLastUpdatedAt(): Promise<number> {
    return 0;
  }
  async findAllRunIdsForSet(): Promise<{ runIds: string[]; reachedCap: boolean }> {
    return { runIds: [], reachedCap: false };
  }
  async getDistinctExternalSetIds(): Promise<Set<string>> {
    return new Set();
  }
  async countRunsForExport(): Promise<number> {
    return 0;
  }
  async findRunsForExport(): Promise<{
    runs: SimulationExportRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: [], hasMore: false };
  }
}
