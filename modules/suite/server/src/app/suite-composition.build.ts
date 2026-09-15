// Build SuiteApp collaborators; `execution` field is deliberately refused.
import type { AgentApi } from "@langwatch/agent-contract";
import { resolvePlatformDefaultRetentionDays } from "@langwatch/data-retention-contract";
import { HandledError } from "@langwatch/handled-error";
import type { ConnectedPresenceReader } from "../services/connected-target.service.ts";
import type { SuiteAppConfig, SuiteExecution } from "./suite.app.ts";

/**
 * A suite run cannot be scheduled on this process. See the file header for
 * why: the seam from a queued suite run to the scenario module's own event
 * stream is not yet decided.
 */
export class SuiteExecutionUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor() {
    super("service_unavailable", "Starting a suite run is not available on this deployment", {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "SuiteExecutionUnavailableError";
  }
}

/** Refuses every run by name, rather than crashing on an absent collaborator. */
class UnavailableSuiteExecution implements SuiteExecution {
  execute(): ReturnType<SuiteExecution["execute"]> {
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
  defaultRetentionDays: number;
  publicBaseUrl: string | undefined;
}

/**
 * Builds {@link SuiteAppInfrastructure} from this App's own config and the
 * ONE peer it already depends on for agent presence.
 */
export function buildSuiteInfrastructure(input: {
  agents: Pick<AgentApi, "getPresence">;
  config: SuiteAppConfig;
}): SuiteAppInfrastructure {
  return {
    execution: new UnavailableSuiteExecution(),
    // The agent directory this App already depends on answers presence
    // directly; no member and no optional bag are needed to ask it.
    connectedPresence: (presenceInput) => input.agents.getPresence(presenceInput),
    // The one platform default every retention-aware feature resolves the
    // same way, off the same process environment (ADR-* data retention).
    defaultRetentionDays: resolvePlatformDefaultRetentionDays(process.env),
    publicBaseUrl: input.config.publicBaseUrl,
  };
}
