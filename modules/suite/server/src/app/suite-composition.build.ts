/**
 * Builds the collaborators `SuiteApp.create` used to receive as a hand-fed
 * `SuiteAppInfrastructure` bag, over the deleted composition
 * (`apps/api/src/features/suite/suite.composition.ts`, deleted by
 * b383462d96). `suite.server.ts` declares no members supplier at all any
 * more, so every field that bag used to carry has to come from somewhere
 * else: a member this App reads, its own config, a peer it already depends
 * on, or a deliberate refusal.
 *
 * `execution` is the one field this file refuses rather than builds.
 * Queuing a suite run's scenarios was, before b383462d96, a raw write onto
 * the SAME `simulation_processing` eventing pipeline `ScenarioApp` now
 * fronts with `queueSimulationRun(QueueSimulationRunInput)` — but that door
 * reconstructs its own event metadata from structured fields
 * (`actor`, `resolvedModels`, `scenarioVersion`, `parameters`), not from the
 * flat, already-encoded blob {@link SuiteExecutionService} builds, and no
 * module may reach a peer's eventing pipeline directly (only an app may
 * cross that boundary; `apps/tasks` still does for its backfill, and
 * `apps/api` used to for this exact one). Deciding whether `SuiteExecutionService`
 * should build a `QueueSimulationRunInput` instead, or whether `ScenarioApi`
 * should grow a lower-level command, is left to whoever settles it.
 *
 * Refusing by name here changes nothing about what a deployment gets today:
 * nothing has supplied `execution` since b383462d96, so `run`, `runAll` and
 * `runPlan` already answer `undefined is not a function`. This turns that
 * into a named, handled 503 instead.
 */
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
