import { createLogger } from "@langwatch/observability";

const logger = createLogger("langwatch:ops:seat-sharing");

export const SEAT_SHARING_PROCESS_NAME = "seatSharing";

/** One outbox row per daily check, pruned like every recurring process's. */
const CHECK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export interface SeatSharingRunDeps {
  /** Runs the check and keeps the result; a deployment without Cloud admin checks nothing. */
  readonly check: () => Promise<void>;
  readonly deleteDispatchedBefore: (params: {
    processName: string;
    before: number;
  }) => Promise<number>;
  readonly now: () => number;
}

/** A failed check is logged and waits for the next day, as the usage report does. */
export function runSeatSharingCheck(deps: SeatSharingRunDeps): () => Promise<void> {
  return async (): Promise<void> => {
    const startedAt = deps.now();
    try {
      await deps.check();
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "seat sharing check failed (will retry on the next day)",
      );
    }

    try {
      await deps.deleteDispatchedBefore({
        processName: SEAT_SHARING_PROCESS_NAME,
        before: startedAt - CHECK_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "seat sharing outbox retention failed",
      );
    }
  };
}
