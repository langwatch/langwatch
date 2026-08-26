import {
  SimulationService as SimulationServiceContract,
  simulationBatchHistorySchema,
  simulationBatchRunDataSchema,
  simulationBatchSummarySchema,
  simulationCancelRunSchema,
  simulationDeleteRunSchema,
  simulationExportRunSchema,
  simulationFinishRunSchema,
  simulationMessageSnapshotSchema,
  simulationQueueRunSchema,
  simulationAllSuitesRunDataSchema,
  simulationExternalSetSummarySchema,
  simulationRunDataSchema,
  simulationSetDataSchema,
  simulationStartRunSchema,
  simulationTextMessageEndSchema,
  simulationTextMessageStartSchema,
} from "@langwatch/simulation-contract";
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
  SimulationExportFilterInput,
  SimulationExportRunsInput,
  SimulationExternalSetCountInput,
  SimulationExternalSetSummary,
  SimulationAllSuitesRunData,
  SimulationExportRun,
  SimulationLastUpdatedInput,
  SimulationProjectDateRangeInput,
  SimulationProjectIdsInput,
  SimulationFinishRun,
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
} from "@langwatch/simulation-contract";
import type { SimulationExecutionPort } from "../ports/simulation-execution.port";
import type { SimulationRepository } from "../repositories/simulation.repository";

/** Canonical read capability; its only persistence dependency is Simulation's repository. */
export class SimulationService extends SimulationServiceContract {
  static create(
    repository: SimulationRepository,
    execution: SimulationExecutionPort,
  ): SimulationService {
    return new SimulationService(repository, execution);
  }

  private constructor(
    private readonly repository: SimulationRepository,
    private readonly execution: SimulationExecutionPort,
  ) {
    super();
  }

  async getScenarioSetsData(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationSetData[]> {
    return simulationSetDataSchema
      .array()
      .parse(await this.repository.getScenarioSetsData(input));
  }

  async tryGetScenarioRunData(
    input: SimulationScenarioRunInput,
  ): Promise<SimulationRunData | null> {
    const run = await this.repository.tryGetScenarioRunData(input);
    return run === null ? null : simulationRunDataSchema.parse(run);
  }

  async getBatchHistoryForScenarioSet(
    input: SimulationBatchHistoryInput,
  ): Promise<SimulationBatchHistory> {
    return simulationBatchHistorySchema.parse(
      await this.repository.getBatchHistoryForScenarioSet(input),
    );
  }

  async tryGetBatchSummary(
    input: SimulationBatchSummaryInput,
  ): Promise<SimulationBatchSummary | null> {
    const summary = await this.repository.tryGetBatchSummary(input);
    return summary === null ? null : simulationBatchSummarySchema.parse(summary);
  }

  async getRunDataForBatchRun(
    input: SimulationBatchRunInput,
  ): Promise<SimulationBatchRunData> {
    return simulationBatchRunDataSchema.parse(
      await this.repository.getRunDataForBatchRun(input),
    );
  }

  async getRunDataForScenarioSet(
    input: SimulationScenarioSetRunsInput,
  ): Promise<{ runs: SimulationRunData[]; nextCursor?: string; hasMore: boolean }> {
    const result = await this.repository.getRunDataForScenarioSet(input);
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
      .parse(await this.repository.getAllRunDataForScenarioSet(input));
  }

  getBatchRunCountForScenarioSet(
    input: SimulationExternalSetCountInput,
  ): Promise<number> {
    return this.repository.getBatchRunCountForScenarioSet(input);
  }

  async getExternalSetSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.getExternalSetSummaries(input));
  }

  async getInternalSuiteSummaries(
    input: SimulationProjectDateRangeInput,
  ): Promise<SimulationExternalSetSummary[]> {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.getInternalSuiteSummaries(input));
  }

  async getRunDataForAllSuites(
    input: SimulationAllSuitesInput,
  ): Promise<SimulationAllSuitesRunData> {
    return simulationAllSuitesRunDataSchema.parse(
      await this.repository.getRunDataForAllSuites(input),
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
    return this.repository.getDistinctExternalSetIds(input);
  }

  countRunsForExport(input: SimulationExportFilterInput): Promise<number> {
    return this.repository.countRunsForExport(input);
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

  cancelRun(input: SimulationCancelRun): Promise<void> {
    return this.execution.cancelRun(simulationCancelRunSchema.parse(input));
  }

  deleteRun(input: SimulationDeleteRun): Promise<void> {
    return this.execution.deleteRun(simulationDeleteRunSchema.parse(input));
  }
}
