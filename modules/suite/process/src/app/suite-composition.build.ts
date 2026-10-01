// Build SuiteApp collaborators over its own reads and its peers.
import type { AgentApi } from "@langwatch/agent-contract";
import type { ScenarioApi } from "@langwatch/scenario-contract";

import type { ConnectedPresenceReader } from "../services/connected-target.service.ts";
import { SuiteExecutionService } from "../services/suite-execution.service.ts";
import type { SuiteRunModelsResolver } from "../services/suite-run-models.service.ts";
import type { SuiteExecution, SuiteRunCommands } from "./suite.app.ts";

/**
 * What `SuiteApp.create` builds for itself, over its own reads and its
 * peers — the same role `SuiteAppInfrastructure` played when the deleted
 * composition supplied it from outside.
 */
export interface SuiteAppInfrastructure {
  execution: SuiteExecution;
  connectedPresence: ConnectedPresenceReader;
  publicBaseUrl: string | undefined;
}

/**
 * Builds {@link SuiteAppInfrastructure}: a run starts on `suite_run_processing`
 * and each of its scenario runs is queued by the scenario owner (main's `SuiteRunService`).
 */
export function buildSuiteInfrastructure(input: {
  agents: Pick<AgentApi, "getPresence">;
  scenarios: Pick<ScenarioApi, "resolveRunParametersForScenarios" | "queueSimulationRun">;
  commands: SuiteRunCommands;
  resolveRunModels?: SuiteRunModelsResolver;
  publicBaseUrl: string | undefined;
}): SuiteAppInfrastructure {
  return {
    execution: SuiteExecutionService.create({
      commands: input.commands,
      scenarios: input.scenarios,
      ...(input.resolveRunModels ? { resolveRunModels: input.resolveRunModels } : {}),
    }),
    // The agent directory this App already depends on answers presence
    // directly; no member and no optional bag are needed to ask it.
    connectedPresence: (presenceInput) => input.agents.getPresence(presenceInput),
    publicBaseUrl: input.publicBaseUrl,
  };
}
