/**
 * The composition point for the usage report.
 *
 * The fields themselves are declared in `usage-report/dictionary.ts` and read
 * in `usage-report/collect.ts`, so the payload and the docs page come from one
 * list and cannot drift. This resolves the pieces the composition root owns
 * and hands them over.
 */

import { getApp } from "~/server/app-layer/app";
import type { InstanceUsageStatsRepository } from "~/server/app-layer/usage-stats/repositories/instance-usage.clickhouse.repository";
import { prisma } from "~/server/db";
import {
  collectUsageReport,
  type UsageReportSwitches,
} from "~/server/usage-report/collect";

export async function collectUsageStats({
  organizationIds,
  instanceId,
  firstSeenAt = null,
  switches,
  repository = getApp().usageStats.instance,
  now,
}: {
  organizationIds: string[];
  /** The identity the sender already resolved. */
  instanceId: string;
  firstSeenAt?: Date | null;
  switches?: UsageReportSwitches;
  /** Defaults to the repository the composition root built. */
  repository?: InstanceUsageStatsRepository;
  now?: Date;
}): Promise<Record<string, unknown>> {
  return await collectUsageReport({
    prisma,
    organizationIds,
    instanceId,
    firstSeenAt,
    repository,
    ...(switches ? { switches } : {}),
    ...(now ? { now } : {}),
  });
}
