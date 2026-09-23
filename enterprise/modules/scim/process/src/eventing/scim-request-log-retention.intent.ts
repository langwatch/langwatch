// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:scim:request-log:retention");

export const SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME = "scimRequestLogRetention";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const RETENTION_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface ScimRequestLogRetentionDeps {
  /** Drops what has aged out of the retention window; answers how many rows went. */
  sweep: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runScimRequestLogRetention(deps: ScimRequestLogRetentionDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();
    const dropped = await deps.sweep();
    if (dropped > 0) {
      logger.info({ dropped }, "recorded SCIM requests past their retention were dropped");
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: SCIM_REQUEST_LOG_RETENTION_PROCESS_NAME,
        before: startedAt - RETENTION_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "SCIM request log retention outbox retention failed",
      );
    }
  };
}
