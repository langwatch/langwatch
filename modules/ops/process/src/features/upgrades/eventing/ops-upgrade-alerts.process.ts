import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

const logger = createLogger("langwatch:ops:upgrade-alerts");

export const UPGRADE_ALERTS_PROCESS_NAME = "upgradeAlerts";

/** Hourly, as plan 6.2 places the alert check beside the system-migration re-drive. */
export const UPGRADE_ALERTS_INTERVAL_MS = 60 * 60_000;

/** Outbox rows are bookkeeping, one per check, pruned like every recurring process's. */
const CHECK_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export const upgradeAlertsCheckSchema = z.object({
  since: z.number().int(),
  until: z.number().int(),
});

export const upgradeAlertsStateSchema = z.object({
  lastCheckedAt: z.number().nullable(),
});
type UpgradeAlertsState = z.infer<typeof upgradeAlertsStateSchema>;

export const UPGRADE_ALERTS_INITIAL_STATE: UpgradeAlertsState = { lastCheckedAt: null };

type UpgradeAlertsIntents = {
  check: IntentSpec<typeof upgradeAlertsCheckSchema>;
};

/**
 * Each check covers the time since the previous wake, so a worker that was down for a while
 * still alerts what failed meanwhile, and nothing is alerted twice. Keyed by the wake.
 */
export const upgradeAlertsWake: WakeHandler<UpgradeAlertsState, UpgradeAlertsIntents> = (
  state,
  ctx,
) => ({
  state: { lastCheckedAt: ctx.at },
  intents: [
    ctx.intent("check", `check:${ctx.at}`, {
      since: state.lastCheckedAt ?? ctx.at - UPGRADE_ALERTS_INTERVAL_MS,
      until: ctx.at,
    }),
  ],
});

/** A check that dies is logged; its window is not re-run, the banner still shows the state. */
export function runUpgradeAlertsCheck(deps: {
  check: (input: z.infer<typeof upgradeAlertsCheckSchema>) => Promise<unknown>;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
}): (payload: z.infer<typeof upgradeAlertsCheckSchema>) => Promise<void> {
  return async (window): Promise<void> => {
    try {
      await deps.check(window);
    } catch (error) {
      logger.error(
        { error: error instanceof Error ? error.message : String(error), ...window },
        "upgrade alert check failed",
      );
    }
    try {
      await deps.deleteDispatchedBefore({
        processName: UPGRADE_ALERTS_PROCESS_NAME,
        before: window.until - CHECK_ROW_RETENTION_MS,
      });
    } catch (error) {
      logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        "upgrade alert outbox retention failed",
      );
    }
  };
}
