import { createLogger } from "@langwatch/observability";

import { AGENT_SANDBOX_KEY_REAP_PROCESS_NAME } from "../processes/agent-sandbox-key-reap.process";

const logger = createLogger("langwatch:agent-sandbox:key-reap");

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on the
 * same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface AgentSandboxKeyReapDeps {
  /** Revokes every elapsed, unrevoked sandbox key; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runAgentSandboxKeyReap(deps: AgentSandboxKeyReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    // `reap` reports its own outcome under `langwatch:api-key:agent-sandbox`.
    // A second line here would split one event across two log streams.
    await deps.reap();

    try {
      await deps.deleteDispatchedBefore({
        processName: AGENT_SANDBOX_KEY_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "Agent sandbox key reap outbox retention failed",
      );
    }
  };
}
