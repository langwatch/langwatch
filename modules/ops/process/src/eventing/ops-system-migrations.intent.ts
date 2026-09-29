import { createLogger } from "@langwatch/observability";
import type { z } from "zod";

import type { systemMigrationPassIntentSchema } from "./ops-system-migrations.process.ts";

const logger = createLogger("langwatch:ops:system-migrations:redrive");

export const SYSTEM_MIGRATION_PASS_PROCESS_NAME = "systemMigrationPass";

/** Outbox rows are bookkeeping, one per pass, pruned like every recurring process's. */
const PASS_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SystemMigrationPassDeps {
  /** One pass on this worker, gated on the stored state when it is the re-drive. */
  execute: (input: { redrive: boolean }) => Promise<void>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A pass that dies waits for the next wake or kick, as main's loop did; the cadence never ends. */
export function runSystemMigrationPass(
  deps: SystemMigrationPassDeps,
): (payload: z.infer<typeof systemMigrationPassIntentSchema>) => Promise<void> {
  return async ({ redrive }): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      await deps.execute({ redrive });
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), redrive },
        "system migration pass failed (the next re-drive retries)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: SYSTEM_MIGRATION_PASS_PROCESS_NAME,
        before: startedAt - PASS_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "system migration pass outbox retention failed",
      );
    }
  };
}
