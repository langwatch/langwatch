/**
 * Daily self-hosted usage telemetry sender.
 *
 * Runs as an in-process interval loop, one report per install, following the
 * same pattern as `src/server/observability/anomalyWorker.ts`. Sends nothing
 * when DISABLE_USAGE_STATS or IS_SAAS is set.
 *
 * One report, not one per organization. The identity is the UUID minted into
 * this install's database, so an install carrying three organizations is one
 * install here rather than three unrelated ones, and nothing about the
 * customer travels in the identity.
 *
 * The response is read. It used to be thrown away, so an install whose reports
 * were being refused looked healthy from both sides for as long as it ran; a
 * refusal is now written to the instance row and shown on the checkup page.
 *
 * The receiver is `/api/track_usage` on app.langwatch.ai, and it stays that
 * for every install whose license names no hosted service. A connected install
 * posts the same body to the connect host instead, so one host answers
 * everything it sends (ADR-141, section 6). These statistics are separate from
 * the license sync in both directions: DISABLE_USAGE_STATS stops these and
 * nothing else, and the sync runs whether or not they are switched off.
 */

import { readConnectConfig } from "@ee/licensing/connect/install/connectConfig";
import { installIsEntitled } from "@ee/licensing/connect/install/connectEntitlement";
import {
  installInstanceId,
  readInstanceIdentityRow,
  recordInstanceReport,
} from "@ee/licensing/connect/install/instanceIdentity";
import { createLogger } from "@langwatch/observability";
import { env } from "~/env.mjs";
import type { PrismaClient } from "~/generated/prisma/client";
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

/**
 * The one host a connected install talks to, the app host otherwise.
 *
 * An install whose license names a hosted service already talks to the connect
 * host for its license sync, so its statistics go there too and one host
 * answers everything it sends. An install on an offline license keeps posting
 * where it always has, which is the upgrade guarantee: the destination does
 * not move under an operator who changed nothing.
 */
export async function usageStatsEndpoint(
  prismaClient: PrismaClient = prisma,
): Promise<string> {
  const connected = await installIsEntitled({ prisma: prismaClient });
  if (!connected) return USAGE_STATS_APP_HOST_URL;
  return `${readConnectConfig().licenseEndpoint}/v1/stats`;
}

/** One report for the whole install, and what came back. */
export async function sendUsageStats(
  prismaClient: PrismaClient = prisma,
): Promise<void> {
  const organizations = await prismaClient.organization.findMany({
    select: { id: true },
  });

  if (organizations.length === 0) {
    logger.debug("no organizations found, skipping usage stats");
    return;
  }

  // Default to self-hosted if not specified, as the old worker did.
  const endpoint = await usageStatsEndpoint(prismaClient);
  const instanceId = await installInstanceId(prismaClient);
  const identity = await readInstanceIdentityRow(prismaClient);

  try {
    // Every field, including the identity and the deployment shape, comes from
    // the dictionary. The event name is the only thing added here, because it
    // names the route rather than the install.
    const stats = await collectUsageStats({
      organizationIds: organizations.map((organization) => organization.id),
      instanceId,
      firstSeenAt: identity?.createdAt ?? null,
      switches: {
        optional: !identity?.optionalMetricsOptOut,
        hostname: !identity?.hostnameOptOut,
      },
    });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: "daily_usage_stats", ...stats }),
    });

    if (!response.ok) {
      // Named by status rather than by body: the body is whatever the host
      // chose to say, and the status is what an operator can act on.
      const refusal = `usage_report_refused_${response.status}`;
      logger.warn(
        { instanceId, status: response.status },
        "usage stats refused",
      );
      await recordInstanceReport({
        prisma: prismaClient,
        error: refusal,
        at: new Date(),
      });
      return;
    }

    await recordInstanceReport({
      prisma: prismaClient,
      error: null,
      at: new Date(),
    });
    logger.info({ instanceId }, "usage stats sent");
  } catch (error) {
    logger.error({ instanceId, error }, "failed to send usage stats");
    await recordInstanceReport({
      prisma: prismaClient,
      error: "usage_report_unreachable",
      at: new Date(),
    }).catch(() => undefined);
    await withScope(async (scope) => {
      scope.setTag?.("worker", "usageStats");
      scope.setExtra?.("instanceId", instanceId);
      captureException(toError(error));
    });
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
      await sendUsageStats();
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
