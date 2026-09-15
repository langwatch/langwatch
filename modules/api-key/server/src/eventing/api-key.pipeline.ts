/**
 * Two hourly sweeps retire credentials nothing else revokes: an abandoned
 * sandbox key, and a stale CLI login key with its cascaded ingest keys. Built
 * against the installing graph's own store and app, so each reap prunes and revokes through it.
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
