/**
 * The sweep that says a way back in is ending (D05 — see
 * specs/identity/sso-onboarding-tiers.feature).
 *
 * An in-process interval loop, the same shape as `usageStatsWorker` and the
 * anomaly workers next to it: there is no per-organization calendar to keep
 * and no row to schedule against, only "which bindings have passed a
 * fourteen, seven or one day mark since the last look".
 *
 * It never expires anything. A binding stops being a way in because two
 * numbers are compared at the moment somebody asks, so an installation whose
 * worker was down over a weekend still has an expiry that happened on the
 * date it said it would. This loop exists purely so nobody is surprised by
 * that date, which is why a missed tick costs a late warning rather than an
 * access decision nobody made.
 */

import { createLogger } from "@langwatch/observability";
import { ssoBreakGlass } from "~/server/app-layer/identity/runtime";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:breakGlassExpiryWorker");

/**
 * Hourly. The marks are whole days apart, so an hour is far finer than the
 * thing being measured — which is what makes a restart, a deploy or a slow
 * tick invisible in what anybody actually receives.
 */
export const BREAK_GLASS_SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface BreakGlassExpiryWorkerHandle {
  stop(): void;
}

export function startBreakGlassExpiryWorker():
  | BreakGlassExpiryWorkerHandle
  | undefined {
  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const { warned } = await ssoBreakGlass().sweepWarnings();
      if (warned > 0) {
        logger.info({ warned }, "break-glass expiry warnings sent");
      }
    } catch (error) {
      logger.warn(
        { error },
        "break-glass expiry sweep failed (will retry on the next interval)",
      );
      await withScope(async (scope) => {
        scope.setTag?.("worker", "breakGlassExpiry");
        captureException(toError(error));
      });
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), BREAK_GLASS_SWEEP_INTERVAL_MS);
    }
  };

  // The first tick runs a minute in rather than at boot: a pod that restarts
  // in a crash loop would otherwise re-send whatever it had not yet recorded
  // as sent, and a minute is long enough for the projection and the database
  // pool to be ready.
  timer = setTimeout(() => void tick(), 60_000);
  logger.info("break-glass expiry worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("break-glass expiry worker stopped");
    },
  };
}
