import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:auth:sign-in-lock:reap");

export const SIGN_IN_LOCK_REAP_PROCESS_NAME = "signInLockReap";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SignInLockReapDeps {
  /** Removes the rows that are finished with; answers how many went. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runSignInLockReap(deps: SignInLockReapDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    const swept = await deps.reap();
    if (swept > 0) {
      logger.info({ swept }, "finished sign-in lock-out rows removed");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: SIGN_IN_LOCK_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "sign-in lock-out reap outbox retention failed",
      );
    }
  };
}
