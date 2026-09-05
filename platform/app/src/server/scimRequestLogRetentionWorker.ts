/**
 * The sweep that drops recorded requests once they age out (ADR-126 — see
 * specs/identity/scim-request-log.feature).
 *
 * An in-process interval loop, the same shape as `breakGlassExpiryWorker`
 * beside it: there is no calendar to keep and no row to schedule against,
 * only "which rows are older than the window".
 *
 * THIS IS WHY THE TABLE IS NOT AN EVENT LOG. An event log has no retention;
 * operational evidence does. A missed tick costs nothing but a few extra rows
 * kept a few hours longer — nothing downstream derives from them, which is
 * the property that makes deleting them safe at all.
 */

import { ScimRequestLogService } from "@ee/scim/scim-request-log.service";
import { createLogger } from "@langwatch/observability";
import { prisma } from "~/server/db";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:scimRequestLogRetention");

/**
 * Every six hours. The window is measured in days, so the interval is far
 * finer than the thing being enforced — a restart, a deploy or a slow tick
 * cannot make a row outlive its window by anything a reader would notice.
 */
export const SCIM_REQUEST_LOG_SWEEP_INTERVAL_MS = 6 * 60 * 60 * 1000;

export interface ScimRequestLogRetentionWorkerHandle {
  stop(): void;
}

export function startScimRequestLogRetentionWorker():
  | ScimRequestLogRetentionWorkerHandle
  | undefined {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const dropped = await ScimRequestLogService.create(prisma).sweepExpired({
        now: new Date(),
      });
      if (dropped > 0) {
        logger.info(
          { dropped },
          "recorded SCIM requests past their retention were dropped",
        );
      }
    } catch (error) {
      logger.warn(
        { error },
        "SCIM request log retention sweep failed (will retry on the next interval)",
      );
      await withScope(async (scope) => {
        scope.setTag?.("worker", "scimRequestLogRetention");
        captureException(toError(error));
      });
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), SCIM_REQUEST_LOG_SWEEP_INTERVAL_MS);
    }
  };

  // A minute in rather than at boot, for the same reason its neighbour waits:
  // long enough for the database pool to be ready, and short enough that a
  // long-lived pod does the first sweep well inside its first shift.
  timer = setTimeout(() => void tick(), 60_000);
  logger.info("SCIM request log retention worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("SCIM request log retention worker stopped");
    },
  };
}
