// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Every procedure exposed by `activityMonitorRouter`, paired with a minimal
 * valid invocation. The router composes the SAME guard chain on all of them
 * (`checkOrganizationPermission("activityMonitor:view")` then the enterprise
 * gate), and both guards run BEFORE the resolver — so these inputs only need to
 * pass zod validation for the guard to fire. The guard-chain tests loop over
 * this list so a newly-added procedure that forgets a guard fails the suite
 * instead of slipping through unnoticed.
 *
 * If a future procedure is added with a deliberately different guard set, give
 * it its own assertion rather than adding it here.
 */
import type { appRouter } from "~/server/api/root";

type Caller = ReturnType<typeof appRouter.createCaller>;

const DUMMY_SOURCE_ID = "src-guard-probe";

export const ACTIVITY_MONITOR_PROCEDURES: ReadonlyArray<
  readonly [string, (caller: Caller, organizationId: string) => Promise<unknown>]
> = [
  [
    "summary",
    (c, organizationId) =>
      c.activityMonitor.summary({ organizationId, windowDays: 7 }),
  ],
  [
    "spendByUser",
    (c, organizationId) =>
      c.activityMonitor.spendByUser({ organizationId, windowDays: 7, limit: 10 }),
  ],
  [
    "spendByTeam",
    (c, organizationId) =>
      c.activityMonitor.spendByTeam({ organizationId, windowDays: 7 }),
  ],
  [
    "spendByDepartment",
    (c, organizationId) =>
      c.activityMonitor.spendByDepartment({ organizationId, windowDays: 7 }),
  ],
  [
    "spendOverTime",
    (c, organizationId) =>
      c.activityMonitor.spendOverTime({
        organizationId,
        windowDays: 7,
        groupBy: "team",
      }),
  ],
  [
    "categoryBreakdown",
    (c, organizationId) =>
      c.activityMonitor.categoryBreakdown({ organizationId, windowDays: 7 }),
  ],
  [
    "ingestionSourcesHealth",
    (c, organizationId) =>
      c.activityMonitor.ingestionSourcesHealth({ organizationId }),
  ],
  [
    "recentAnomalies",
    (c, organizationId) =>
      c.activityMonitor.recentAnomalies({ organizationId }),
  ],
  [
    "eventsForSource",
    (c, organizationId) =>
      c.activityMonitor.eventsForSource({
        organizationId,
        sourceId: DUMMY_SOURCE_ID,
      }),
  ],
  [
    "sourceHealthMetrics",
    (c, organizationId) =>
      c.activityMonitor.sourceHealthMetrics({
        organizationId,
        sourceId: DUMMY_SOURCE_ID,
      }),
  ],
];
