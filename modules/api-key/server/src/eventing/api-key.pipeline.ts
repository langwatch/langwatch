/**
 * API keys' event sourcing: the hourly sweep that retires the sandbox keys a
 * code agent run left behind, since nothing else revokes an elapsed one. It is
 * built against the process store of the graph that installs it, because the
 * outbox rows the reap writes have to be the ones that graph prunes.
 */
import { defineEventingModule, type EventingSetup } from "@langwatch/eventing";
import type { ApiKeyApp } from "../app/api-key.app.ts";
import type { ApiKeyRepositories } from "../repositories/api-key.repositories.ts";
import { AgentSandboxKeyReapService } from "../services/agent-sandbox-key-reap.service.ts";
import { EventingAgentSandboxMaintenanceAdapter } from "../services/agent-sandbox-maintenance.service.ts";

export const apiKeyEventing = defineEventingModule({
  pipeline: "agent_sandbox_maintenance",
  build: ({ repositories, processStore }: EventingSetup<ApiKeyRepositories, ApiKeyApp>) => {
    const reap = AgentSandboxKeyReapService.create({ repository: repositories.apiKeys });
    return EventingAgentSandboxMaintenanceAdapter.create({
      sandboxKeyReap: {
        reap: () => reap.reap(),
        deleteDispatchedBefore: (params) => processStore.deleteDispatchedBefore(params),
      },
    }).build();
  },
});
