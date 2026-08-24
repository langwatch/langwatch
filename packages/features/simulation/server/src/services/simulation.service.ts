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

  constructor(
    private readonly repository: SimulationRepository,
    private readonly execution: SimulationExecutionPort,
  ) {
    super();
  }

  async getScenarioSetsData(
    input: Parameters<SimulationRepository["getScenarioSetsData"]>[0],
  ) {
    return simulationSetDataSchema
      .array()
      .parse(await this.repository.getScenarioSetsData(input));
  }

  async tryGetScenarioRunData(
    input: Parameters<SimulationRepository["tryGetScenarioRunData"]>[0],
  ) {
    const run = await this.repository.tryGetScenarioRunData(input);
    return run === null ? null : simulationRunDataSchema.parse(run);
  }

  async getBatchHistoryForScenarioSet(
    input: Parameters<SimulationRepository["getBatchHistoryForScenarioSet"]>[0],
  ) {
    return simulationBatchHistorySchema.parse(
      await this.repository.getBatchHistoryForScenarioSet(input),
    );
  }

  async tryGetBatchSummary(
    input: Parameters<SimulationRepository["tryGetBatchSummary"]>[0],
  ) {
    const summary = await this.repository.tryGetBatchSummary(input);
    return summary === null ? null : simulationBatchSummarySchema.parse(summary);
  }

  async getRunDataForBatchRun(
    input: Parameters<SimulationRepository["getRunDataForBatchRun"]>[0],
  ) {
    return simulationBatchRunDataSchema.parse(
      await this.repository.getRunDataForBatchRun(input),
    );
  }

  async getRunDataForScenarioSet(
    input: Parameters<SimulationRepository["getRunDataForScenarioSet"]>[0],
  ) {
    const result = await this.repository.getRunDataForScenarioSet(input);
    return {
      ...result,
      runs: simulationRunDataSchema.array().parse(result.runs),
    };
  }

  async getAllRunDataForScenarioSet(
    input: Parameters<SimulationRepository["getAllRunDataForScenarioSet"]>[0],
  ) {
    return simulationRunDataSchema
      .array()
      .parse(await this.repository.getAllRunDataForScenarioSet(input));
  }

  getBatchRunCountForScenarioSet(
    input: Parameters<SimulationRepository["getBatchRunCountForScenarioSet"]>[0],
  ) {
    return this.repository.getBatchRunCountForScenarioSet(input);
  }

  async getExternalSetSummaries(
    input: Parameters<SimulationRepository["getExternalSetSummaries"]>[0],
  ) {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.getExternalSetSummaries(input));
  }

  async getInternalSuiteSummaries(
    input: Parameters<SimulationRepository["getInternalSuiteSummaries"]>[0],
  ) {
    return simulationExternalSetSummarySchema
      .array()
      .parse(await this.repository.getInternalSuiteSummaries(input));
  }

  async getRunDataForAllSuites(
    input: Parameters<SimulationRepository["getRunDataForAllSuites"]>[0],
  ) {
    return simulationAllSuitesRunDataSchema.parse(
      await this.repository.getRunDataForAllSuites(input),
    );
  }

  getLastUpdatedAt(
    input: Parameters<SimulationRepository["findLastUpdatedAt"]>[0],
  ) {
    return this.repository.findLastUpdatedAt(input);
  }

  getRunIdsForSet(
    input: Parameters<SimulationRepository["findAllRunIdsForSet"]>[0],
  ) {
    return this.repository.findAllRunIdsForSet(input);
  }

  getDistinctExternalSetIds(
    input: Parameters<SimulationRepository["getDistinctExternalSetIds"]>[0],
  ) {
    return this.repository.getDistinctExternalSetIds(input);
  }

  countRunsForExport(
    input: Parameters<SimulationRepository["countRunsForExport"]>[0],
  ) {
    return this.repository.countRunsForExport(input);
  }

  async findRunsForExport(
    input: Parameters<SimulationRepository["findRunsForExport"]>[0],
  ) {
    const result = await this.repository.findRunsForExport(input);
    return {
      ...result,
      runs: simulationExportRunSchema.array().parse(result.runs),
    };
  }

  queueRun(input: Parameters<SimulationExecutionPort["queueRun"]>[0]) {
    return this.execution.queueRun(simulationQueueRunSchema.parse(input));
  }

  startRun(input: Parameters<SimulationExecutionPort["startRun"]>[0]) {
    return this.execution.startRun(simulationStartRunSchema.parse(input));
  }

  messageSnapshot(
    input: Parameters<SimulationExecutionPort["messageSnapshot"]>[0],
  ) {
    return this.execution.messageSnapshot(
      simulationMessageSnapshotSchema.parse(input),
    );
  }

  textMessageStart(
    input: Parameters<SimulationExecutionPort["textMessageStart"]>[0],
  ) {
    return this.execution.textMessageStart(
      simulationTextMessageStartSchema.parse(input),
    );
  }

  textMessageEnd(
    input: Parameters<SimulationExecutionPort["textMessageEnd"]>[0],
  ) {
    return this.execution.textMessageEnd(
      simulationTextMessageEndSchema.parse(input),
    );
  }

  finishRun(input: Parameters<SimulationExecutionPort["finishRun"]>[0]) {
    return this.execution.finishRun(simulationFinishRunSchema.parse(input));
  }

  cancelRun(input: Parameters<SimulationExecutionPort["cancelRun"]>[0]) {
    return this.execution.cancelRun(simulationCancelRunSchema.parse(input));
  }

  deleteRun(input: Parameters<SimulationExecutionPort["deleteRun"]>[0]) {
    return this.execution.deleteRun(simulationDeleteRunSchema.parse(input));
  }

}
