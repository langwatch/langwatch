import type {
  SimulationAllSuitesRunData,
  SimulationBatchHistory,
  SimulationBatchRunData,
  SimulationBatchSummary,
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationExportRun,
  SimulationExternalSetSummary,
  SimulationLastResultSummary,
  SimulationFinishRun,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationRunData,
  SimulationSetData,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/simulation-contract";
import { SimulationService } from "@langwatch/simulation-contract";

function unused(): never {
  throw new Error("Unused SimulationService test method");
}

/** Complete typed fake for tests whose only observable is `finishRun`. */
export class TestSimulationService extends SimulationService {
  constructor(private readonly finish: (input: SimulationFinishRun) => Promise<void>) {
    super();
  }

  getScenarioSetsData(): Promise<SimulationSetData[]> {
    return unused();
  }
  tryGetScenarioRunData(): Promise<SimulationRunData | null> {
    return unused();
  }
  getBatchHistoryForScenarioSet(): Promise<SimulationBatchHistory> {
    return unused();
  }
  tryGetBatchSummary(): Promise<SimulationBatchSummary | null> {
    return unused();
  }
  getRunDataForBatchRun(): Promise<SimulationBatchRunData> {
    return unused();
  }
  getRunDataForScenarioSet(): Promise<{
    runs: SimulationRunData[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return unused();
  }
  getAllRunDataForScenarioSet(): Promise<SimulationRunData[]> {
    return unused();
  }
  getBatchRunCountForScenarioSet(): Promise<number> {
    return unused();
  }
  getExternalSetSummaries(): Promise<SimulationExternalSetSummary[]> {
    return unused();
  }
  getInternalSuiteSummaries(): Promise<SimulationExternalSetSummary[]> {
    return unused();
  }
  getLastResultSummaries(): Promise<SimulationLastResultSummary[]> {
    return unused();
  }
  getRunDataForAllSuites(): Promise<SimulationAllSuitesRunData> {
    return unused();
  }
  getLastUpdatedAt(): Promise<number> {
    return unused();
  }
  getRunIdsForSet(): Promise<{ runIds: string[]; reachedCap: boolean }> {
    return unused();
  }
  getDistinctExternalSetIds(): Promise<Set<string>> {
    return unused();
  }
  countRunsForExport(): Promise<number> {
    return unused();
  }
  findRunsForExport(): Promise<{
    runs: SimulationExportRun[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    return unused();
  }
  queueRun(_input: SimulationQueueRun): Promise<void> {
    return unused();
  }
  startRun(_input: SimulationStartRun): Promise<void> {
    return unused();
  }
  messageSnapshot(_input: SimulationMessageSnapshot): Promise<void> {
    return unused();
  }
  textMessageStart(_input: SimulationTextMessageStart): Promise<void> {
    return unused();
  }
  textMessageEnd(_input: SimulationTextMessageEnd): Promise<void> {
    return unused();
  }
  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.finish(input);
  }
  cancelRun(_input: SimulationCancelRun): Promise<void> {
    return unused();
  }
  deleteRun(_input: SimulationDeleteRun): Promise<void> {
    return unused();
  }
}
