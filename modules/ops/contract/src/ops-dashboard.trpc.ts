/**
 * The `ops.*` procedures the dashboard and scheduler page call - the
 * browser's cache keys. Split across five files: the router builder caps
 * around fifty procedures per namespace, and this surface has ninety-two.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { dashboardDataSchema, queueSummaryInfoSchema } from "./ops-dashboard.ts";
import { opsListParkedQueueGroupsInputSchema, opsParkedGroupsPageSchema } from "./ops-queue.ts";
import {
  opsListPausedSchedulesInputSchema,
  opsListScheduledJobsInputSchema,
  opsListSchedulerActionsInputSchema,
  opsScheduleIdInputSchema,
  opsScheduledJobSchema,
  opsSetScheduleActiveInputSchema,
  schedulerAuditEntryViewSchema,
} from "./ops-scheduler.ts";
import { opsSignUpHealthInputSchema, signUpHealthSchema } from "./ops-sign-up-health.ts";
import {
  opsApiGetBadgeCountsOutputSchema,
  opsPausedSchedulesPageSchema,
  opsScopeProbeSchema,
} from "./ops.responses.ts";

export const opsDashboardTrpc = defineTrpcContract("ops")
  /**
   * The caller's own operator scope. Answers `{ kind: "none" }` rather than
   * refusing, so the global menu can poll it on every page load without
   * spamming the console with permission errors (lw#3584).
   */
  .query("getScope")
  .withInput(z.void())
  .withOutput(opsScopeProbeSchema)

  .query("getDashboardSnapshot")
  .withInput(z.void())
  .withOutput(dashboardDataSchema.nullable())

  /**
   * The two integers the global ops badge renders, without the full dashboard
   * aggregation behind them. This is the one to poll; the snapshot is for the
   * ops route itself.
   */
  .query("getBadgeCounts")
  .withInput(z.void())
  .withOutput(opsApiGetBadgeCountsOutputSchema)

  /** The orphaned-organization rate join-before-create exists to reduce (D12), for any window. */
  .query("getSignUpHealth")
  .withInput(opsSignUpHealthInputSchema)
  .withOutput(signUpHealthSchema)

  .subscription("dashboardStream")
  .withInput(z.void())
  .withOutput(dashboardDataSchema)

  /**
   * One parked tenant's groups, read live rather than from the snapshot: a
   * parking storm can hold hundreds of thousands of groups, which a
   * snapshot every pod reads would recreate the size problem ADR-090 removes.
   */
  .query("listParkedGroups")
  .withInput(opsListParkedQueueGroupsInputSchema)
  .withOutput(opsParkedGroupsPageSchema)

  .query("listQueues")
  .withInput(z.void())
  .withOutput(queueSummaryInfoSchema.array())

  .query("listScheduledJobs")
  .withInput(opsListScheduledJobsInputSchema)
  .withOutput(opsScheduledJobSchema.array())

  /**
   * Only the switched-off schedules, for the dashboard's "Switched off" panel.
   * Its own read because `listScheduledJobs` sorts active first, so a client
   * filtering that page would miss every paused row on a large fleet.
   */
  .query("listPausedSchedules")
  .withInput(opsListPausedSchedulesInputSchema)
  .withOutput(opsPausedSchedulesPageSchema)

  .query("listSchedulerActions")
  .withInput(opsListSchedulerActionsInputSchema)
  .withOutput(schedulerAuditEntryViewSchema.array())

  /**
   * Pause or resume a schedule (ADR-091). Never touches an in-flight slot: the
   * confirmation copy says so, because a pause that silently killed a live run
   * would be a much larger promise than the one being made.
   */
  .mutation("setScheduleActive")
  .withInput(opsSetScheduleActiveInputSchema)
  .withOutput(opsScheduledJobSchema)

  /** Release a slot whose worker stopped responding, so it can be claimed again. */
  .mutation("clearScheduleSlot")
  .withInput(opsScheduleIdInputSchema)
  .withOutput(opsScheduledJobSchema)

  /**
   * Make a schedule due immediately. The loop claims and runs it through the
   * ordinary path, so this inherits its exactly-once lease rather than
   * bypassing it.
   */
  .mutation("runScheduleNow")
  .withInput(opsScheduleIdInputSchema)
  .withOutput(opsScheduledJobSchema)
  .build();
