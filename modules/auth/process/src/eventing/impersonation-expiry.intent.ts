import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:auth:impersonation:expiry");

export const IMPERSONATION_EXPIRY_PROCESS_NAME = "impersonationExpiry";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface ImpersonationExpiryDeps {
  /** Audits and clears the lapsed windows; answers how many were cleared. */
  sweep: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runImpersonationExpiry(deps: ImpersonationExpiryDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    const expired = await deps.sweep();
    if (expired > 0) {
      logger.info({ expired }, "lapsed impersonation windows audited and cleared");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: IMPERSONATION_EXPIRY_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "impersonation expiry outbox retention failed",
      );
    }
  };
}
