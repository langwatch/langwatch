import type {
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationExportRun,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationRunData,
  SimulationSetData,
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
} from "@langwatch/scenario-contract";

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
  abstract findScenarioSetsData(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationSetData[]>;
  abstract findScenarioRunData(
    input: SimulationScenarioRunInput,
  ): Promise<SimulationRunData | null>;
  abstract findBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory>;
  abstract findBatchSummary(
    input: SimulationBatchSummaryInput,
  ): Promise<SimulationBatchSummary | null>;
  abstract findRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData>;
  abstract findRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }>;
  abstract findAllRunDataForScenarioSet(
    input: SimulationScenarioSetInput,
  ): Promise<SimulationRunData[]>;
  abstract findBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number>;
  abstract findExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  abstract findInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]>;
  abstract findLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]>;
  abstract findRunDataForAllSuites(
    input: SimulationAllSuitesInput,
  ): Promise<AllSimulationSuitesRunData>;
  abstract findLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number>;
  abstract findAllRunIdsForSet(
    input: SimulationScenarioSetInput,
  ): Promise<{ runIds: string[]; reachedCap: boolean }>;
  abstract findDistinctExternalSetIds(input: SimulationProjectIdsInput): Promise<Set<string>>;
  abstract countRunsForExport(input: SimulationExportFilterInput): Promise<number>;
  abstract countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<number>;
  abstract findRunsForExport(
    input: SimulationExportRunsInput,
  ): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }>;
}

/** Deliberate disabled-store implementation for local and test composition. */
export class NullSimulationRepository extends SimulationRepository {
  async findScenarioSetsData(): Promise<SimulationSetData[]> {
    return [];
  }
  async findScenarioRunData(): Promise<SimulationRunData | null> {
    return null;
  }
  async findBatchHistoryForScenarioSet(): Promise<SimulationBatchHistory> {
    return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
  }
  async findBatchSummary(): Promise<SimulationBatchSummary | null> {
    return null;
  }
  async findRunDataForBatchRun(): Promise<SimulationBatchRunData> {
    return { changed: true, lastUpdatedAt: 0, runs: [] };
  }
  async findRunDataForScenarioSet(): Promise<{
    runs: SimulationRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: [], hasMore: false };
  }
  async findAllRunDataForScenarioSet(): Promise<SimulationRunData[]> {
    return [];
  }
  async findBatchRunCountForScenarioSet(): Promise<number> {
    return 0;
  }
  async findExternalSetSummaries(): Promise<SimulationExternalSetSummary[]> {
    return [];
  }
  async findInternalSuiteSummaries(): Promise<SimulationExternalSetSummary[]> {
    return [];
  }
  async findLastResultSummaries(): Promise<SimulationLastResultSummary[]> {
    return [];
  }
  async findRunDataForAllSuites(): Promise<AllSimulationSuitesRunData> {
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
  async findDistinctExternalSetIds(): Promise<Set<string>> {
    return new Set();
  }
  async countRunsForExport(): Promise<number> {
    return 0;
  }
  async countUsage(): Promise<number> {
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
