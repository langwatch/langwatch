/**
 * API keys' event sourcing: the two hourly sweeps that retire credentials
 * nothing else revokes — the sandbox key a code agent run left behind, and
 * the CLI login key a device session stopped refreshing (and, through the
 * ordinary revoke cascade, the ingest keys parented to it). Built against
 * the process store of the graph that installs it, because the outbox rows
 * each reap writes have to be the ones that graph prunes, and against the
 * installing graph's own app, so the login-key sweep revokes through the
 * same bindings/cascade logic every other revoke path uses.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";
import type { ApiKeyApp } from "../app/api-key.app.ts";
import type { ApiKeyRepositories } from "../repositories/api-key.repositories.ts";
import { AgentSandboxKeyReapService } from "../services/agent-sandbox-key-reap.service.ts";
import { EventingAgentSandboxMaintenanceAdapter } from "../services/agent-sandbox-maintenance.service.ts";
import { CliLoginKeyReapService } from "../services/cli-login-key-reap.service.ts";

export const apiKeyEventing = defineEventingModule({
  pipeline: "agent_sandbox_maintenance",
  build: ({ repositories, app, processStore }: EventingSetup<ApiKeyRepositories, ApiKeyApp>) => {
    const reap = AgentSandboxKeyReapService.create({ repository: repositories.apiKeys });
    const loginKeyReap = CliLoginKeyReapService.create({
      repository: repositories.apiKeys,
      revoke: ({ id, organizationId, userId }) =>
        app.revoke({ id, organizationId, callerUserId: userId, callerIsAdmin: true, cause: "expired" }),
    });
    return EventingAgentSandboxMaintenanceAdapter.create({
      sandboxKeyReap: {
        reap: () => reap.reap(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
      cliLoginKeyReap: {
        reap: () => loginKeyReap.reap(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
    }).build();
  },
});
