import { createLogger } from "../../utils/logger/server";
import { featureFlagService } from "../featureFlag";
import { connection } from "../redis";
import { AnomalyDetector } from "./anomalyDetector";
import { AnomalyStateStore } from "./anomalyState";
import { TenantRateTracker } from "./tenantRateTracker";

const logger = createLogger("langwatch:observability:anomalyWorker");

const TICK_INTERVAL_MS = 60_000;

export interface AnomalyWorkerHandle {
  stop(): Promise<void>;
}

/**
 * Long-running scheduler that calls AnomalyDetector.tick() every 60s.
 * Stays running as long as the workers process is alive. Failures in
 * an individual tick are logged but do not crash the loop — observability
 * must degrade gracefully.
 */
export function startAnomalyWorker(): AnomalyWorkerHandle | undefined {
  if (!connection) {
    logger.warn("Redis connection unavailable, anomaly worker disabled");
    return undefined;
  }

  const rateTracker = new TenantRateTracker(
    connection,
    Date.now,
    featureFlagService,
  );
  const anomalyState = new AnomalyStateStore(connection);
  const detector = new AnomalyDetector({
    rateTracker,
    anomalyState,
    featureFlagService,
    // The hard-tier auto-pause hook is wired here. Currently a no-op
    // (logs only) — pairing it with the per-tenant pause mechanism is
    // tracked separately. The detector still emits the hard-tier
    // anomaly + paged log so oncall sees it within seconds.
    onHardTier: async (anomaly) => {
      logger.error(
        {
          tenantId: anomaly.tenantId,
          currentRate: anomaly.currentRate,
          baseline: anomaly.baseline,
          reason: anomaly.reason,
        },
        "HARD-TIER anomaly: manual investigation required (auto-pause not yet wired)",
      );
    },
  });

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await detector.tick();
      if (result.surfaced > 0 || result.cleared > 0) {
        logger.info(result, "anomaly tick");
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : String(err) },
        "anomaly detector tick failed (will retry on next interval)",
      );
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), TICK_INTERVAL_MS);
    }
  };

  // Initial tick after a short delay so the workers process has a chance
  // to settle before competing for Redis.
  timer = setTimeout(() => void tick(), 5_000);

  logger.info("anomaly worker started");

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("anomaly worker stopped");
    },
  };
}
