import { defineAggregate, defineEvents, definePipeline, type Event } from "@langwatch/eventing";

import {
  type AgentSandboxKeyReapDeps,
  runAgentSandboxKeyReap,
} from "../intents/agent-sandbox-key-reap.intent";
import {
  AGENT_SANDBOX_KEY_REAP_INITIAL_STATE,
  AGENT_SANDBOX_KEY_REAP_INTERVAL_MS,
  AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
  type AgentSandboxKeyReapState,
  agentSandboxKeyReapSchema,
  agentSandboxKeyReapWake,
} from "../processes/agent-sandbox-key-reap.process";

export interface AgentSandboxMaintenancePipelineDeps {
  sandboxKeyReap: AgentSandboxKeyReapDeps;
}

/**
 * Credential maintenance for code agent runs, in its own pipeline for the same
 * reason blob_maintenance and langy_maintenance are in theirs: retiring the
 * keys a run left behind belongs to neither the run nor the queue.
 *
 * A sandbox key is minted per run and has no counterpart at the end of one, so
 * this sweep is the only thing that retires it.
 *
 * WHY IT LIVES WITH API KEYS rather than with the code agent that mints the
 * key: the sweep's whole predicate is over the `ApiKey` model, bounded by the
 * reserved name `@langwatch/api-key-contract` reserves, and the cross-tenant
 * hatch it rides is the ApiKey one in `guardOrganizationId`. The minting side
 * belongs to the run; retiring a credential belongs to the credential.
 *
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export class EventingAgentSandboxMaintenanceAdapter {
  private constructor(private readonly deps: AgentSandboxMaintenancePipelineDeps) {}

  static create(deps: AgentSandboxMaintenancePipelineDeps): EventingAgentSandboxMaintenanceAdapter {
    return new EventingAgentSandboxMaintenanceAdapter(deps);
  }

  build() {
    const sandboxKeyReap = this.deps.sandboxKeyReap;

    return definePipeline<Event>({
      name: "agent_sandbox_maintenance",
      aggregate: defineAggregate({
        // `global`, like the other maintenance pipelines: this one appends no
        // events, and the sweep spans every tenant by design.
        type: "global",
        events: defineEvents([]),
      }),
    })
      .withProcessManager(AGENT_SANDBOX_KEY_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<AgentSandboxKeyReapState>(AGENT_SANDBOX_KEY_REAP_INITIAL_STATE)
          .schedule({ everyMs: AGENT_SANDBOX_KEY_REAP_INTERVAL_MS })
          .onWake(agentSandboxKeyReapWake)
          .intent("reap", agentSandboxKeyReapSchema, runAgentSandboxKeyReap(sandboxKeyReap))
          // One bounded UPDATE over the (name, revokedAt, expiresAt) index, so
          // the default-ish lease is ample.
          .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 }),
      )
      .build();
  }
}
