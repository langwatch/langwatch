import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:ops:group-queue-reaper");

export const GROUP_QUEUE_REAPER_PROCESS_NAME = "groupQueueReaper";

/** Outbox rows are bookkeeping, one per reap, pruned like every recurring process's. */
const REAP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface GroupQueueReapDeps {
  /** One reap; the service logs what it freed. */
  reap: () => Promise<unknown>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A failed reap waits for the next wake; stranded groups only grow slowly. */
export function runGroupQueueReap(deps: GroupQueueReapDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      await deps.reap();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "stranded queue group reap failed (will retry on next interval)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: GROUP_QUEUE_REAPER_PROCESS_NAME,
        before: startedAt - REAP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "group queue reaper outbox retention failed",
      );
    }
  };
}
