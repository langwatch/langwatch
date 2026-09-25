import {
  SimulationService as SimulationServiceContract,
  simulationCancelRunSchema,
  simulationDeleteRunSchema,
  simulationRecordAgentInstanceSchema,
  simulationFinishRunSchema,
  recordEvaluationsCommandDataSchema,
  simulationMessageSnapshotSchema,
  simulationQueueRunSchema,
  simulationStartRunSchema,
  simulationTextMessageEndSchema,
  simulationTextMessageStartSchema,
} from "@langwatch/scenario-contract";
import type {
  SimulationAllSuitesInput,
  SimulationBatchHistory,
  SimulationBatchHistoryInput,
  SimulationBatchRunData,
  SimulationBatchRunInput,
  SimulationBatchSummary,
  SimulationBatchSummaryInput,
  SimulationCancelRun,
  SimulationDeleteRun,
  SimulationRecordAgentInstance,
  SimulationExportFilterInput,
  SimulationExportRunsInput,
  SimulationExternalSetCountInput,
  SimulationExternalSetSummary,
  SimulationAllSuitesRunData,
  SimulationExportRun,
  SimulationLastUpdatedInput,
  SimulationLastResultSummariesInput,
  SimulationLastResultSummary,
  SimulationProjectDateRangeInput,
  SimulationProjectIdsInput,
  SimulationFinishRun,
  RecordEvaluationsCommandData,
  SimulationMessageSnapshot,
  SimulationQueueRun,
  SimulationRunData,
  SimulationScenarioRunInput,
  SimulationScenarioSetInput,
  SimulationScenarioSetRunsInput,
  SimulationSetData,
  SimulationStartRun,
  SimulationTextMessageEnd,
  SimulationTextMessageStart,
} from "@langwatch/scenario-contract";

import type { SimulationExecutionRepository } from "../repositories/simulation-execution.repository.ts";
import type { SimulationRepository } from "../repositories/simulation.repository.ts";

/** Canonical read capability; its only persistence dependency is Simulation's repository. */
export class SimulationService extends SimulationServiceContract {
  static create(
    repository: SimulationRepository,
    execution: SimulationExecutionRepository,
  ): SimulationService {
    return new SimulationService(repository, execution);
  }

  private constructor(
    private readonly repository: SimulationRepository,
    private readonly execution: SimulationExecutionRepository,
  ) {
    super();
  }

  getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]> {
    return this.repository.findScenarioSetsData(input);
  }

  findScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null> {
    return this.repository.findScenarioRunData(input);
  }

  getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory> {
    return this.repository.listBatchHistoryForScenarioSet(input);
  }

  findBatchSummary(input: SimulationBatchSummaryInput): Promise<SimulationBatchSummary | null> {
    return this.repository.findBatchSummary(input);
  }

  getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData> {
    return this.repository.findRunDataForBatchRun(input);
  }

  getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    return this.repository.listRunDataForScenarioSet(input);
  }

  getAllRunDataForScenarioSet(input: SimulationScenarioSetInput): Promise<SimulationRunData[]> {
    return this.repository.findAllRunDataForScenarioSet(input);
  }

  getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number> {
    return this.repository.findBatchRunCountForScenarioSet(input);
  }

  getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.repository.findExternalSetSummaries(input);
  }

  getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return this.repository.findInternalSuiteSummaries(input);
  }

  getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]> {
    return this.repository.findLastResultSummaries(input);
  }

  getRunDataForAllSuites(input: SimulationAllSuitesInput): Promise<SimulationAllSuitesRunData> {
    return this.repository.findRunDataForAllSuites(input);
  }

  getLastUpdatedAt(input: SimulationLastUpdatedInput): Promise<number> {
    return this.repository.findLastUpdatedAt(input);
  }

  getRunIdsForSet(
    input: SimulationScenarioSetInput,
  ): Promise<{ runIds: string[]; reachedCap: boolean }> {
    return this.repository.findAllRunIdsForSet(input);
  }

  getDistinctExternalSetIds(input: SimulationProjectIdsInput): Promise<Set<string>> {
    return this.repository.findDistinctExternalSetIds(input);
  }

  countRunsForExport(input: SimulationExportFilterInput): Promise<number> {
    return this.repository.countRunsForExport(input);
  }

  countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<number> {
    return this.repository.countUsage(input);
  }

  listRunsForExport(
    input: SimulationExportRunsInput,
  ): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }> {
    return this.repository.listRunsForExport(input);
  }

  queueRun(input: SimulationQueueRun): Promise<void> {
    return this.execution.queueRun(simulationQueueRunSchema.parse(input));
  }

  startRun(input: SimulationStartRun): Promise<void> {
    return this.execution.startRun(simulationStartRunSchema.parse(input));
  }

  messageSnapshot(input: SimulationMessageSnapshot): Promise<void> {
    return this.execution.messageSnapshot(simulationMessageSnapshotSchema.parse(input));
  }

  textMessageStart(input: SimulationTextMessageStart): Promise<void> {
    return this.execution.textMessageStart(simulationTextMessageStartSchema.parse(input));
  }

  textMessageEnd(input: SimulationTextMessageEnd): Promise<void> {
    return this.execution.textMessageEnd(simulationTextMessageEndSchema.parse(input));
  }

  finishRun(input: SimulationFinishRun): Promise<void> {
    return this.execution.finishRun(simulationFinishRunSchema.parse(input));
  }

  recordEvaluations(input: RecordEvaluationsCommandData): Promise<void> {
    return this.execution.recordEvaluations(recordEvaluationsCommandDataSchema.parse(input));
  }

  cancelRun(input: SimulationCancelRun): Promise<void> {
    return this.execution.cancelRun(simulationCancelRunSchema.parse(input));
  }

  deleteRun(input: SimulationDeleteRun): Promise<void> {
    return this.execution.deleteRun(simulationDeleteRunSchema.parse(input));
  }

  recordAgentInstance(input: SimulationRecordAgentInstance): Promise<void> {
    return this.execution.recordAgentInstance(simulationRecordAgentInstanceSchema.parse(input));
  }
}
