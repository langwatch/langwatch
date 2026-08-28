import { definePipeline, type Event } from "@langwatch/eventing";
import {
  AGENT_SANDBOX_KEY_REAP_INTERVAL_MS,
  AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
  type AgentSandboxKeyReapDeps,
  type AgentSandboxKeyReapState,
  agentSandboxKeyReapSchema,
  agentSandboxKeyReapWake,
  runAgentSandboxKeyReap,
} from "./process-manager/agentSandboxKeyReap.process";

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
 * The pipeline carries no events and no commands. A process manager with no
 * event handlers registers no subscriber, so this costs nothing beyond the
 * scheduled wake it exists for.
 */
export function createAgentSandboxMaintenancePipeline(
  deps: AgentSandboxMaintenancePipelineDeps,
) {
  return (
    definePipeline<Event>()
      .withName("agent_sandbox_maintenance")
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      .withAggregateType("global")
      .withProcessManager(AGENT_SANDBOX_KEY_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<AgentSandboxKeyReapState>({ lastReapAt: null })
          .schedule({ everyMs: AGENT_SANDBOX_KEY_REAP_INTERVAL_MS })
          .onWake(agentSandboxKeyReapWake)
          .intent(
            "reap",
            agentSandboxKeyReapSchema,
            runAgentSandboxKeyReap(deps.sandboxKeyReap),
          )
          // One bounded UPDATE over the (name, revokedAt, expiresAt) index, so
          // the default-ish lease is ample.
          .outbox({ leaseDurationMs: 60 * 1000, maxAttempts: 3 }),
      )
      .build()
  );
}
