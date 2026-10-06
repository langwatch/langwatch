import { ScenarioSimulationsUnavailableError } from "@langwatch/scenario-contract";

import { SimulationRepository } from "../simulation.repository.ts";

/**
 * The memory tier opens no ClickHouse: every run read is refused by name, as the live
 * read's absence always was, never answered empty while the run fold holds runs.
 */
export class MemorySimulationRepository extends SimulationRepository {
  static create(): MemorySimulationRepository {
    return new MemorySimulationRepository();
  }

  private constructor() {
    super();
  }

  private refuse<T>(): Promise<T> {
    return Promise.reject(new ScenarioSimulationsUnavailableError());
  }

  findScenarioSetsData(): ReturnType<SimulationRepository["findScenarioSetsData"]> {
    return this.refuse();
  }
  findScenarioRunData(): ReturnType<SimulationRepository["findScenarioRunData"]> {
    return this.refuse();
  }
  listBatchHistoryForScenarioSet(): ReturnType<
    SimulationRepository["listBatchHistoryForScenarioSet"]
  > {
    return this.refuse();
  }
  findBatchSummary(): ReturnType<SimulationRepository["findBatchSummary"]> {
    return this.refuse();
  }
  findRunDataForBatchRun(): ReturnType<SimulationRepository["findRunDataForBatchRun"]> {
    return this.refuse();
  }
  listRunDataForScenarioSet(): ReturnType<SimulationRepository["listRunDataForScenarioSet"]> {
    return this.refuse();
  }
  findAllRunDataForScenarioSet(): ReturnType<SimulationRepository["findAllRunDataForScenarioSet"]> {
    return this.refuse();
  }
  findBatchRunCountForScenarioSet(): ReturnType<
    SimulationRepository["findBatchRunCountForScenarioSet"]
  > {
    return this.refuse();
  }
  findExternalSetSummaries(): ReturnType<SimulationRepository["findExternalSetSummaries"]> {
    return this.refuse();
  }
  findInternalSuiteSummaries(): ReturnType<SimulationRepository["findInternalSuiteSummaries"]> {
    return this.refuse();
  }
  findLastResultSummaries(): ReturnType<SimulationRepository["findLastResultSummaries"]> {
    return this.refuse();
  }
  findRunDataForAllSuites(): ReturnType<SimulationRepository["findRunDataForAllSuites"]> {
    return this.refuse();
  }
  findLastUpdatedAt(): ReturnType<SimulationRepository["findLastUpdatedAt"]> {
    return this.refuse();
  }
  findAllRunIdsForSet(): ReturnType<SimulationRepository["findAllRunIdsForSet"]> {
    return this.refuse();
  }
  findDistinctExternalSetIds(): ReturnType<SimulationRepository["findDistinctExternalSetIds"]> {
    return this.refuse();
  }
  countRunsForExport(): ReturnType<SimulationRepository["countRunsForExport"]> {
    return this.refuse();
  }
  countUsage(): ReturnType<SimulationRepository["countUsage"]> {
    return this.refuse();
  }
  countOrganizationRuns(): ReturnType<SimulationRepository["countOrganizationRuns"]> {
    return this.refuse();
  }
  listRunsForExport(): ReturnType<SimulationRepository["listRunsForExport"]> {
    return this.refuse();
  }
}
