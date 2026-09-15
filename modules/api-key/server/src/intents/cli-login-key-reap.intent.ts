import { createLogger } from "@langwatch/observability";

import { CLI_LOGIN_KEY_REAP_PROCESS_NAME } from "../processes/cli-login-key-reap.process.ts";

const logger = createLogger("langwatch:cli-login-key:reap");

/**
 * Outbox rows this process writes are bookkeeping, one per tick, pruned on
 * the same schedule every other recurring process uses.
 */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface CliLoginKeyReapDeps {
  /** Revokes every elapsed, unrevoked login key and its children; returns the count. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runCliLoginKeyReap(deps: CliLoginKeyReapDeps) {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    // `reap` reports its own outcome under `langwatch:api-key:cli-login-key-reaper`.
    // A second line here would split one event across two log streams.
    await deps.reap();

    try {
      await deps.deleteDispatchedBefore({
        processName: CLI_LOGIN_KEY_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "CLI login key reap outbox retention failed",
      );
    }
  };
}
