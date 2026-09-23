// Build SuiteApp collaborators; `execution` field is deliberately refused.
import type { AgentApi } from "@langwatch/agent-contract";
import { SuiteExecutionUnavailableError, type SuiteRunResult } from "@langwatch/suite-contract";

import type { ConnectedPresenceReader } from "../services/connected-target.service.ts";
import type { SuiteExecution } from "./suite.app.ts";

/** Refuses every run by name, rather than crashing on an absent collaborator. */
class UnavailableSuiteExecution implements SuiteExecution {
  execute(): Promise<SuiteRunResult> {
    return Promise.reject(new SuiteExecutionUnavailableError());
  }
}

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
 * Builds {@link SuiteAppInfrastructure} from this App's own config and the
 * ONE peer it already depends on for agent presence.
 */
export function buildSuiteInfrastructure(input: {
  agents: Pick<AgentApi, "getPresence">;
  publicBaseUrl: string | undefined;
}): SuiteAppInfrastructure {
  return {
    execution: new UnavailableSuiteExecution(),
    // The agent directory this App already depends on answers presence
    // directly; no member and no optional bag are needed to ask it.
    connectedPresence: (presenceInput) => input.agents.getPresence(presenceInput),
    publicBaseUrl: input.publicBaseUrl,
  };
}
