import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:organization:access-digest");

export const ACCESS_DIGEST_PROCESS_NAME = "accessNoticeDigest";

/** Outbox rows are bookkeeping, one per wake, pruned like every recurring process's. */
const SWEEP_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

interface AccessDigestDeps {
  send: () => Promise<unknown>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now?: () => number;
}

/** A failed sweep waits for the next wake; the held notices stay held until one claims them. */
export function runAccessDigestSweep(deps: AccessDigestDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = (deps.now ?? Date.now)();

    try {
      await deps.send();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "access notice digest sweep failed (will retry on next interval)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: ACCESS_DIGEST_PROCESS_NAME,
        before: startedAt - SWEEP_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "access notice digest outbox retention failed",
      );
    }
  };
}
