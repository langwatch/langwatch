import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:organization:private-dataplane");

export const PRIVATE_DATAPLANE_RECORDER_PROCESS_NAME = "privateDataplaneRecorder";

/** Outbox rows are bookkeeping, one per wake, pruned like every recurring process's. */
const RECORD_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface PrivateDataplaneRecordDeps {
  record: () => Promise<unknown>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A failed record waits for the next wake; the route it would record is still serving. */
export function runPrivateDataplaneRecord(deps: PrivateDataplaneRecordDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      await deps.record();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "private dataplane record failed (will retry on next interval)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: PRIVATE_DATAPLANE_RECORDER_PROCESS_NAME,
        before: startedAt - RECORD_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "private dataplane recorder outbox retention failed",
      );
    }
  };
}
