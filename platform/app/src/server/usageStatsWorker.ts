/**
 * Daily self-hosted usage telemetry sender.
 *
 * Runs as an in-process interval loop, one send per organization,
 * following the same pattern as
 * `src/server/observability/anomalyWorker.ts`. Sends nothing when
 * DISABLE_USAGE_STATS or IS_SAAS is set.
 *
 * The receiver is `/api/track_usage` on app.langwatch.ai, and it stays that
 * for every install that has not switched Connect on. A connected install
 * posts the same body to the connect host instead, so one host answers
 * everything it sends (ADR-139, section 6). These statistics are separate from
 * the license sync in both directions: DISABLE_USAGE_STATS stops these and
 * nothing else, and the sync runs whether or not they are switched off.
 */

import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
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

/** Where the app host has always taken these statistics. */
export const USAGE_STATS_APP_HOST_URL =
  "https://app.langwatch.ai/api/track_usage";

/** The one host a connected install talks to, the app host otherwise. */
export function usageStatsEndpoint(): string {
  const config = readConnectConfig();
  return config.enabled
    ? `${config.licenseEndpoint}/v1/stats`
    : USAGE_STATS_APP_HOST_URL;
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
  const endpoint = usageStatsEndpoint();

  for (const organization of organizations) {
    const instanceId = `${organization.name}__${organization.id}`;
    try {
      const stats = await collectUsageStats({ instanceId });
      await fetch(endpoint, {
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
      logger.warn(
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
