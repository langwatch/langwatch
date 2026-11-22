import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:stored-object:upload-reap");

export const UPLOAD_REAP_PROCESS_NAME = "storedObjectUploadReap";

/** Outbox rows are bookkeeping, one per tick, pruned like every recurring process's. */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface UploadReapDeps {
  /** Deletes the bytes of expired pending uploads and marks them failed; answers how many. */
  reap: () => Promise<number>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

export function runUploadReap(deps: UploadReapDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    const reaped = await deps.reap();
    if (reaped > 0) logger.info({ reaped }, "expired pending uploads reaped");

    try {
      await deps.deleteDispatchedBefore({
        processName: UPLOAD_REAP_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "stored-object upload reap outbox retention failed",
      );
    }
  };
}
