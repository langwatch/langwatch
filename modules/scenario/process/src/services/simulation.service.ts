import {
  SimulationService as SimulationServiceContract,
  simulationBatchHistorySchema,
  simulationBatchRunDataSchema,
  simulationBatchSummarySchema,
  simulationCancelRunSchema,
  simulationDeleteRunSchema,
  simulationRecordAgentInstanceSchema,
  simulationExportRunSchema,
  simulationFinishRunSchema,
  recordEvaluationsCommandDataSchema,
  simulationMessageSnapshotSchema,
  simulationQueueRunSchema,
  simulationAllSuitesRunDataSchema,
  simulationExternalSetSummarySchema,
  simulationLastResultSummarySchema,
  simulationRunDataSchema,
  simulationSetDataSchema,
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

  async getScenarioSetsData(input: SimulationProjectDateRangeInput): Promise<SimulationSetData[]> {
    return simulationSetDataSchema.array().parse(await this.repository.findScenarioSetsData(input));
  }

  async findScenarioRunData(input: SimulationScenarioRunInput): Promise<SimulationRunData | null> {
    const run = await this.repository.findScenarioRunData(input);

    return run === null ? null : simulationRunDataSchema.parse(run);
  }

  async getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory> {
    return simulationBatchHistorySchema.parse(
      await this.repository.findBatchHistoryForScenarioSet(input),
    );
  }

  async findBatchSummary(
    input: SimulationBatchSummaryInput,
  ): Promise<SimulationBatchSummary | null> {
    const summary = await this.repository.findBatchSummary(input);

    return summary === null ? null : simulationBatchSummarySchema.parse(summary);
  }

  async getRunDataForBatchRun(input: SimulationBatchRunInput): Promise<SimulationBatchRunData> {
    return simulationBatchRunDataSchema.parse(await this.repository.findRunDataForBatchRun(input));
  }

  async getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    const result = await this.repository.findRunDataForScenarioSet(input);

    return {
      ...result,
      runs: simulationRunDataSchema.array().parse(result.runs),
    };
  }

  async getAllRunDataForScenarioSet(
    input: SimulationScenarioSetInput,
  ): Promise<SimulationRunData[]> {
    return simulationRunDataSchema
      .array()
      .parse(await this.repository.findAllRunDataForScenarioSet(input));
  }

  getBatchRunCountForScenarioSet(input: SimulationExternalSetCountInput): Promise<number> {
    return this.repository.findBatchRunCountForScenarioSet(input);
  }

  async getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.findExternalSetSummaries(input));
  }

  async getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.findInternalSuiteSummaries(input));
  }

  async getLastResultSummaries(
    input: SimulationLastResultSummariesInput,
  ): Promise<SimulationLastResultSummary[]> {
    return simulationLastResultSummarySchema
      .array()
      .parse(await this.repository.findLastResultSummaries(input));
  }

  async getRunDataForAllSuites(
    input: SimulationAllSuitesInput,
  ): Promise<SimulationAllSuitesRunData> {
    return simulationAllSuitesRunDataSchema.parse(
      await this.repository.findRunDataForAllSuites(input),
    );
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

  async findRunsForExport(
    input: SimulationExportRunsInput,
  ): Promise<{ runs: SimulationExportRun[]; nextCursor?: string; hasMore: boolean }> {
    const result = await this.repository.findRunsForExport(input);

    return {
      ...result,
      runs: simulationExportRunSchema.array().parse(result.runs),
    };
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
