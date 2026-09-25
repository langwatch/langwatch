/**
 * Two hourly sweeps retire credentials nothing else revokes: an abandoned
 * sandbox key, and a stale CLI login key with its cascaded ingest keys. Built
 * against the installing graph's own store and app, so each reap prunes and revokes through it.
 */

import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { ApiKeyApp } from "../app/api-key.app.ts";
import type { ApiKeyRepositories } from "../repositories/api-key.repositories.ts";
import { AgentSandboxKeyReapService } from "../services/agent-sandbox-key-reap.service.ts";
import { CliLoginKeyReapService } from "../services/cli-login-key-reap.service.ts";
import {
  type AgentSandboxKeyReapDeps,
  runAgentSandboxKeyReap,
} from "./agent-sandbox-key-reap.intent.ts";
import {
  AGENT_SANDBOX_KEY_REAP_INITIAL_STATE,
  AGENT_SANDBOX_KEY_REAP_INTERVAL_MS,
  AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
  type AgentSandboxKeyReapState,
  agentSandboxKeyReapSchema,
  agentSandboxKeyReapWake,
} from "./agent-sandbox-key-reap.process.ts";
import { type CliLoginKeyReapDeps, runCliLoginKeyReap } from "./cli-login-key-reap.intent.ts";
import {
  CLI_LOGIN_KEY_REAP_INITIAL_STATE,
  CLI_LOGIN_KEY_REAP_INTERVAL_MS,
  CLI_LOGIN_KEY_REAP_PROCESS_NAME,
  type CliLoginKeyReapState,
  cliLoginKeyReapSchema,
  cliLoginKeyReapWake,
} from "./cli-login-key-reap.process.ts";

export const apiKeyEventing = defineEventingModule({
  pipeline: "agent_sandbox_maintenance",
  build: ({ repositories, app, processStore }: EventingSetup<ApiKeyRepositories, ApiKeyApp>) => {
    const reap = AgentSandboxKeyReapService.create({ repository: repositories.apiKeys });
    const loginKeyReap = CliLoginKeyReapService.create({
      repository: repositories.apiKeys,
      revoke: ({ id, organizationId, userId }) =>
        app.revoke({
          id,
          organizationId,
          callerUserId: userId,
          callerIsAdmin: true,
          cause: "expired",
        }),
    });
    return buildAgentSandboxMaintenancePipeline({
      sandboxKeyReap: {
        reap: () => reap.reap(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
      cliLoginKeyReap: {
        reap: () => loginKeyReap.reap(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
    });
  },
});

export interface AgentSandboxMaintenancePipelineDeps {
  sandboxKeyReap: AgentSandboxKeyReapDeps;
  /** The hourly sweep over CLI login keys whose session ran out. */
  cliLoginKeyReap: CliLoginKeyReapDeps;
}

// Credential maintenance the API-key feature owns end to end: the sandbox key a code agent run
// left behind, and the CLI login key a device session stopped refreshing. Neither is retired by
// anything else, so both are scheduled sweeps rather than event-driven. No events; costs nothing
// beyond scheduled wake.
export function buildAgentSandboxMaintenancePipeline({
  sandboxKeyReap,
  cliLoginKeyReap,
}: AgentSandboxMaintenancePipelineDeps): StaticPipelineDefinition<Event> {
  return definePipeline({
    name: "agent_sandbox_maintenance",
    aggregate: defineAggregate({
      // `global`, like the other maintenance pipelines: this one appends no
      // events, and the sweep spans every tenant by design.
      type: "global",
    }),
  })
    .withEvents([])
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
