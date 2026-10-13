import type { EventingCommandSender, EventingCommands } from "@langwatch/eventing";
import type { SimulationService } from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { SimulationProcessingPipelineDefinition } from "../../eventing/simulation-processing.pipeline.ts";
import type { SimulationRepository } from "../../repositories/simulation.repository.ts";

/** Each repository read, and the service read a service-shaped fake answers it with. */
const servedReads = {
  findScenarioSetsData: "getScenarioSetsData",
  findScenarioRunData: "findScenarioRunData",
  listBatchHistoryForScenarioSet: "getBatchHistoryForScenarioSet",
  findBatchSummary: "findBatchSummary",
  findRunDataForBatchRun: "getRunDataForBatchRun",
  listRunDataForScenarioSet: "getRunDataForScenarioSet",
  findAllRunDataForScenarioSet: "getAllRunDataForScenarioSet",
  findBatchRunCountForScenarioSet: "getBatchRunCountForScenarioSet",
  findExternalSetSummaries: "getExternalSetSummaries",
  findInternalSuiteSummaries: "getInternalSuiteSummaries",
  findLastResultSummaries: "getLastResultSummaries",
  findRunDataForAllSuites: "getRunDataForAllSuites",
  findLastUpdatedAt: "getLastUpdatedAt",
  findAllRunIdsForSet: "getRunIdsForSet",
  findDistinctExternalSetIds: "getDistinctExternalSetIds",
  countRunsForExport: "countRunsForExport",
  countUsage: "countUsage",
  countOrganizationRuns: "countOrganizationRuns",
  listRunsForExport: "listRunsForExport",
} as const satisfies Record<keyof SimulationRepository, keyof SimulationService>;

/** The writes simulation_processing sends, under the service's own names. */
const sentWrites = [
  "queueRun",
  "startRun",
  "messageSnapshot",
  "textMessageStart",
  "textMessageEnd",
  "finishRun",
  "recordEvaluations",
  "cancelRun",
  "deleteRun",
  "recordAgentInstance",
  "recordCutAtLimit",
] as const satisfies readonly (keyof SimulationService)[];

/** The registry's simulation reads, answered by a service-shaped fake; any other read throws. */
export function simulationRepositoryOver(fake: Partial<SimulationService>): SimulationRepository {
  const reads = Object.fromEntries(
    Object.entries(servedReads).flatMap(([read, served]) => {
      const answer = fake[served];
      return answer ? [[read, answer]] : [];
    }),
  );
  return createApiFixture<SimulationRepository>(reads, "Simulation repository");
}

/** simulation_processing's senders, each handing its command to the fake's write. */
export function simulationSendersOver(
  fake: Partial<SimulationService>,
): EventingCommands<SimulationProcessingPipelineDefinition> {
  const senders = Object.fromEntries(
    sentWrites.flatMap((name) => {
      const write = fake[name];
      if (!write) return [];
      const sender = createApiFixture<EventingCommandSender<unknown>>(
        { send: (data) => write(data as never) },
        name,
      );
      return [[name, sender]];
    }),
  );
  return createApiFixture<EventingCommands<SimulationProcessingPipelineDefinition>>(
    senders,
    "simulation_processing senders",
  );
}
