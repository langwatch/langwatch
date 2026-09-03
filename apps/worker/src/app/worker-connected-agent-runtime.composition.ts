import { closeConnectedAgentRuntime, installConnectedAgentRedis } from "@langwatch/agent-server";
import type { RedisConnection } from "@langwatch/redis-client";
import type { ResourceScope } from "@langwatch/runtime-composition";

/**
 * Installs Redis into the connected-agent runtime (ADR-128), so this
 * process's experiment orchestrator can dispatch a relay call to an
 * instance the API process registered.
 *
 * The worker mounts no connected-agent transport of its own — the socket
 * and the long-poll session live in the API process that holds them — but
 * `getConnectedAgentRuntime()` is also called from here, by the experiment
 * feature's connected cell (`relayDispatch`). Left uninstalled, that call
 * runs the dispatcher on a private memory store that can never see an
 * instance the API process registered, so every connected experiment column
 * fails `agent_offline` after the first-turn grace. Nothing when the
 * deployment configured no Redis: the same fallback then applies.
 */
export function installWorkerConnectedAgentRuntime(options: {
  redis: RedisConnection | undefined | null;
  resources?: ResourceScope;
}): void {
  if (!options.redis) return;

  installConnectedAgentRedis(options.redis);
  options.resources?.own("worker connected-agent runtime", () => closeConnectedAgentRuntime());
}
