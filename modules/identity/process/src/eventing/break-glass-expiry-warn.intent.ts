import { createLogger } from "@langwatch/observability";

import { BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME } from "./break-glass-expiry-warn.process.ts";

const logger = createLogger("langwatch:identity:break-glass:expiry-warn");

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const WARN_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface BreakGlassExpiryWarnDeps {
  /** Sends any warnings newly due; answers how many bindings were warned. */
  warn: () => Promise<{ warned: number }>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runBreakGlassExpiryWarn(deps: BreakGlassExpiryWarnDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    const { warned } = await deps.warn();
    if (warned > 0) {
      logger.info({ warned }, "break-glass expiry warnings sent");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: BREAK_GLASS_EXPIRY_WARN_PROCESS_NAME,
        before: startedAt - WARN_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "break-glass expiry warn outbox retention failed",
      );
    }
  };
}
