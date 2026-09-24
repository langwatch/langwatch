import {
  defineAggregate,
  definePipeline,
  type Event,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import {
  type AgentSandboxKeyReapDeps,
  runAgentSandboxKeyReap,
} from "../eventing/agent-sandbox-key-reap.intent.ts";
import {
  AGENT_SANDBOX_KEY_REAP_INITIAL_STATE,
  AGENT_SANDBOX_KEY_REAP_INTERVAL_MS,
  AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
  type AgentSandboxKeyReapState,
  agentSandboxKeyReapSchema,
  agentSandboxKeyReapWake,
} from "../eventing/agent-sandbox-key-reap.process.ts";
import {
  type CliLoginKeyReapDeps,
  runCliLoginKeyReap,
} from "../eventing/cli-login-key-reap.intent.ts";
import {
  CLI_LOGIN_KEY_REAP_INITIAL_STATE,
  CLI_LOGIN_KEY_REAP_INTERVAL_MS,
  CLI_LOGIN_KEY_REAP_PROCESS_NAME,
  type CliLoginKeyReapState,
  cliLoginKeyReapSchema,
  cliLoginKeyReapWake,
} from "../eventing/cli-login-key-reap.process.ts";

export interface AgentSandboxMaintenancePipelineDeps {
  sandboxKeyReap: AgentSandboxKeyReapDeps;
  /** The hourly sweep over CLI login keys whose session ran out. */
  cliLoginKeyReap: CliLoginKeyReapDeps;
}

// Credential maintenance the API-key feature owns end to end: the sandbox key a code agent run
// left behind, and the CLI login key a device session stopped refreshing. Neither is retired by
// anything else, so both are scheduled sweeps rather than event-driven. No events; costs nothing
// beyond scheduled wake.
export class EventingAgentSandboxMaintenanceAdapter {
  private constructor(private readonly deps: AgentSandboxMaintenancePipelineDeps) {}

  static create(deps: AgentSandboxMaintenancePipelineDeps): EventingAgentSandboxMaintenanceAdapter {
    return new EventingAgentSandboxMaintenanceAdapter(deps);
  }

  build(): StaticPipelineDefinition<Event> {
    const sandboxKeyReap = this.deps.sandboxKeyReap;
    const cliLoginKeyReap = this.deps.cliLoginKeyReap;

    return definePipeline<Event>({
      name: "agent_sandbox_maintenance",
      aggregate: defineAggregate({
        // `global`, like the other maintenance pipelines: this one appends no
        // events, and the sweep spans every tenant by design.
        type: "global",
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
      .withProcessManager(CLI_LOGIN_KEY_REAP_PROCESS_NAME, (pm) =>
        pm
          .state<CliLoginKeyReapState>(CLI_LOGIN_KEY_REAP_INITIAL_STATE)
          .schedule({ everyMs: CLI_LOGIN_KEY_REAP_INTERVAL_MS })
          .onWake(cliLoginKeyReapWake)
          .intent("reap", cliLoginKeyReapSchema, runCliLoginKeyReap(cliLoginKeyReap))
          // One bounded read, then a revoke per elapsed key with its cascade.
          // Sessions run out a few at a time, so the default-ish lease holds.
          .outbox({ leaseDurationMs: 5 * 60 * 1000, maxAttempts: 3 }),
      )
      .build();
  }
}
