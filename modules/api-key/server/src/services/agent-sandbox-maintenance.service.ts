import { defineAggregate, defineEvents, definePipeline, type Event } from "@langwatch/eventing";

import {
  type AgentSandboxKeyReapDeps,
  runAgentSandboxKeyReap,
} from "../intents/agent-sandbox-key-reap.intent.ts";
import {
  AGENT_SANDBOX_KEY_REAP_INITIAL_STATE,
  AGENT_SANDBOX_KEY_REAP_INTERVAL_MS,
  AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
  type AgentSandboxKeyReapState,
  agentSandboxKeyReapSchema,
  agentSandboxKeyReapWake,
} from "../processes/agent-sandbox-key-reap.process.ts";

export interface AgentSandboxMaintenancePipelineDeps {
  sandboxKeyReap: AgentSandboxKeyReapDeps;
}

// Retiring sandbox keys belongs in credential maintenance, not run management. Keys are minted per
// run and only reaped by this sweep. No events; costs nothing beyond scheduled wake.
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
