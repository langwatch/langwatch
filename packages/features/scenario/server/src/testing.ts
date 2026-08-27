import {
  SimulationService,
  type SimulationAllSuitesRunData,
  type SimulationBatchHistory,
  type SimulationBatchRunData,
  type SimulationBatchSummary,
  type SimulationCancelRun,
  type SimulationDeleteRun,
  type SimulationExportRun,
  type SimulationExternalSetSummary,
  type SimulationFinishRun,
  type SimulationLastResultSummary,
  type SimulationMessageSnapshot,
  type SimulationQueueRun,
  type SimulationRunData,
  type SimulationSetData,
  type SimulationStartRun,
  type SimulationTextMessageEnd,
  type SimulationTextMessageStart,
} from "@langwatch/scenario-contract";

export {
  ClickHouseSimulationRunMetricsRepository,
  SimulationRunMetricsRepositoryClickHouse,
} from "./repositories/clickhouse/clickhouse.simulation-run-metrics.repository";
export {
  ClickHouseSimulationRunStateRepository,
  SimulationRunStateRepositoryClickHouse,
} from "./repositories/clickhouse/clickhouse.simulation-run-state.repository";
export type { SimulationRunMetricsProjectionRecord } from "./projections/simulation-run-metrics.projection";
export type { SimulationRunState } from "./projections/simulation-run-state.projection";

export type TestSimulationServiceOptions = {
  run?: SimulationRunData;
  finishRun?: (input: SimulationFinishRun) => Promise<void>;
};

/** Deterministic Scenario run capability for transport and process tests. */
export class TestSimulationService extends SimulationService {
  static create(options: TestSimulationServiceOptions = {}): TestSimulationService {
    return new TestSimulationService(options);
  }

  private constructor(private readonly options: TestSimulationServiceOptions) {
    super();
  }

  async getScenarioSetsData(): Promise<SimulationSetData[]> {
    return [];
  }

  async tryGetScenarioRunData(): Promise<SimulationRunData | null> {
    return this.options.run ?? null;
  }

  async getBatchHistoryForScenarioSet(): Promise<SimulationBatchHistory> {
    return { batches: [], hasMore: false, lastUpdatedAt: 0, totalCount: 0 };
  }

  async tryGetBatchSummary(): Promise<SimulationBatchSummary | null> {
    return null;
  }

  async getRunDataForBatchRun(): Promise<SimulationBatchRunData> {
    return {
      changed: true,
      lastUpdatedAt: this.options.run?.updatedAt ?? 0,
      runs: this.options.run ? [this.options.run] : [],
    };
  }

  async getRunDataForScenarioSet(): Promise<{
    runs: SimulationRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return { runs: this.options.run ? [this.options.run] : [], hasMore: false };
  }

  async getAllRunDataForScenarioSet(): Promise<SimulationRunData[]> {
    return this.options.run ? [this.options.run] : [];
  }

  async getBatchRunCountForScenarioSet(): Promise<number> {
    return this.options.run ? 1 : 0;
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

  async getRunDataForAllSuites(): Promise<SimulationAllSuitesRunData> {
    return {
      changed: true,
      lastUpdatedAt: this.options.run?.updatedAt ?? 0,
      runs: this.options.run ? [this.options.run] : [],
      scenarioSetIds: {},
      hasMore: false,
    };
  }

  async getLastUpdatedAt(): Promise<number> {
    return this.options.run?.updatedAt ?? 0;
  }

  async getRunIdsForSet(): Promise<{ runIds: string[]; reachedCap: boolean }> {
    return {
      runIds: this.options.run ? [this.options.run.scenarioRunId] : [],
      reachedCap: false,
    };
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

  async queueRun(_input: SimulationQueueRun): Promise<void> {}

  async startRun(_input: SimulationStartRun): Promise<void> {}

  async messageSnapshot(_input: SimulationMessageSnapshot): Promise<void> {}

  async textMessageStart(_input: SimulationTextMessageStart): Promise<void> {}

  async textMessageEnd(_input: SimulationTextMessageEnd): Promise<void> {}

  async finishRun(input: SimulationFinishRun): Promise<void> {
    await this.options.finishRun?.(input);
  }

  async cancelRun(_input: SimulationCancelRun): Promise<void> {}

  async deleteRun(_input: SimulationDeleteRun): Promise<void> {}
}
