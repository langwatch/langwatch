/**
 * Daily self-hosted usage telemetry sender.
 *
 * Replaces the deleted BullMQ usageStatsQueue/usageStatsWorker pair (a
 * per-organization repeatable job at noon daily) with an in-process
 * interval loop, following the same pattern as
 * `src/server/observability/anomalyWorker.ts`. Guarded by the same flags
 * the old worker used: sends nothing when DISABLE_USAGE_STATS or IS_SAAS
 * is set. The `/api/track_usage` receiver on app.langwatch.ai is
 * unchanged.
 */

import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import { collectUsageStats } from "~/server/collectUsageStats";
import { prisma } from "~/server/db";
import {
  captureException,
  toError,
  withScope,
} from "~/utils/posthogErrorCapture";

const logger = createLogger("langwatch:workers:usageStatsWorker");

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageStatsWorkerHandle {
  stop(): void;
}

async function sendUsageStatsForAllOrganizations(): Promise<void> {
  const organizations = await prisma.organization.findMany({
    select: { id: true, name: true },
  });

  if (organizations.length === 0) {
    logger.debug("no organizations found, skipping usage stats");
    return;
  }

  // Default to self-hosted if not specified — mirrors the old worker.
  const installMethod = process.env.INSTALL_METHOD ?? "self-hosted";

  for (const organization of organizations) {
    const instanceId = `${organization.name}__${organization.id}`;
    try {
      const stats = await collectUsageStats(instanceId);
      await fetch("https://app.langwatch.ai/api/track_usage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "daily_usage_stats",
          install_method: installMethod,
          hostname: process.env.BASE_HOST,
          environment: process.env.NODE_ENV,
          instance_id: instanceId,
          ...stats,
        }),
      });
      logger.info({ instanceId }, "usage stats sent");
    } catch (error) {
      logger.error({ instanceId, error }, "failed to send usage stats");
      await withScope(async (scope) => {
        scope.setTag?.("worker", "usageStats");
        scope.setExtra?.("instanceId", instanceId);
        captureException(toError(error));
      });
    }
  }
}

/**
 * Long-running scheduler that sends usage stats once per day. The first
 * tick fires at the next 12:00 UTC (matching the old repeatable job's
 * noon cron), then every 24 hours. Failures in an individual tick are
 * logged + captured but do not crash the loop.
 */
export function startUsageStatsWorker(): UsageStatsWorkerHandle | undefined {
  if (env.DISABLE_USAGE_STATS || env.IS_SAAS) {
    logger.info("usage stats disabled, skipping usage stats worker");
    return undefined;
  }

  let stopped = false;
  let timer: NodeJS.Timeout | undefined;

  const tick = async () => {
    if (stopped) return;
    try {
      await sendUsageStatsForAllOrganizations();
    } catch (error) {
      logger.error(
        { error },
        "usage stats tick failed (will retry on next interval)",
      );
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), DAY_MS);
    }
  };

  const nextNoonUtc = new Date();
  nextNoonUtc.setUTCHours(12, 0, 0, 0);
  let firstTickDelayMs = nextNoonUtc.getTime() - Date.now();
  if (firstTickDelayMs <= 0) firstTickDelayMs += DAY_MS;
  timer = setTimeout(() => void tick(), firstTickDelayMs);

  logger.info({ firstTickDelayMs }, "usage stats worker started");

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      logger.info("usage stats worker stopped");
    },
  };
}
