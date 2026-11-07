// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { CioBatchCall, CioOrgTraits } from "@langwatch/enterprise-nurturing-contract";

import { unixSecondsOf } from "./nurturing-customer-io-timestamp.rules.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_AM_MS = 5 * 60 * 60 * 1000;

/** How far back an organization counts as active, and how far back its traces are counted. */
export const USAGE_WINDOW_MS = 30 * DAY_MS;

/** An organization's usage as its owners count it, before it becomes Customer.io traits. */
export type OrganizationUsage = Readonly<{
  promptCount: number;
  evaluatorCount: number;
  scenarioCount: number;
  traceCount: number;
  errorCount: number;
  totalCost: number;
  /** Epoch ms; null when no trace in the window failed. */
  lastFailedTraceAt: number | null;
}>;

/** The most recent 05:00 UTC at or before this instant. */
function lastFiveAmAtOrBefore(at: number): number {
  const fiveAmToday = Math.floor(at / DAY_MS) * DAY_MS + FIVE_AM_MS;
  return at >= fiveAmToday ? fiveAmToday : fiveAmToday - DAY_MS;
}

/** Whether a 05:00 UTC has passed since the last sync was asked for. */
export function isUsageSyncDue({ at, lastSyncAt }: { at: number; lastSyncAt: number }): boolean {
  return lastFiveAmAtOrBefore(at) > lastSyncAt;
}

/**
 * The organization's one group call: only these traits, so the ones other signals set (name,
 * plan, company size, onboarding) stay as they are. Counts and times only, never content.
 */
export function usageGroupCall({
  organizationId,
  adminUserId,
  usage,
}: {
  organizationId: string;
  adminUserId: string;
  usage: OrganizationUsage;
}): CioBatchCall {
  const traits: Partial<CioOrgTraits> = {
    prompt_count: usage.promptCount,
    evaluator_count: usage.evaluatorCount,
    scenario_count: usage.scenarioCount,
    trace_count: usage.traceCount,
    error_count: usage.errorCount,
    total_cost: usage.totalCost,
    ...(usage.lastFailedTraceAt === null
      ? {}
      : { last_failed_trace_at: unixSecondsOf(usage.lastFailedTraceAt) }),
  };
  return { type: "group", userId: adminUserId, groupId: organizationId, traits };
}
