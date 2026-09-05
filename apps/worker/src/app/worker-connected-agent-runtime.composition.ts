import { ConnectedAgentRuntimeAdapter } from "@langwatch/agent-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ResourceScope } from "@langwatch/runtime-composition";

/**
 * process's experiment orchestrator can dispatch a relay call to an instance the API process
 * registered.
 * Installs Redis into the connected-agent runtime (ADR-128), so this
 */
export function installWorkerConnectedAgentRuntime(options: {
  redis: RedisConnection | undefined | null;
  resources?: ResourceScope;
}): void {
  if (!options.redis) return;

  ConnectedAgentRuntimeAdapter.install(options.redis);
  options.resources?.own("worker connected-agent runtime", () =>
    ConnectedAgentRuntimeAdapter.close(),
  );
}
