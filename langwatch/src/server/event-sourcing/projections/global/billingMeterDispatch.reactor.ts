import { createLogger } from "@langwatch/observability";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "../../../../../ee/billing/services/billableEventsQuery";
import type { Event } from "../../domain/types";
import type { ReportUsageForMonthCommandData } from "../../pipelines/billing-reporting/schemas/commands";
import type { ReactorDefinition } from "../../reactors/reactor.types";
import { throttledPerWindow } from "../../reactors/throttleWindow";

const logger = createLogger("langwatch:billing:meterDispatch");

/** Number of days at the start of a new month to also check the previous month. */
const GRACE_PERIOD_DAYS = 3;

/** How long a project's events are held before one dispatch is sent. */
export const BILLING_METER_DISPATCH_WINDOW_MS = 30_000;

/**
 * How long a project stays suppressed after dispatching. Sized to the
 * downstream command's own dedup window so the two agree on the rate.
 */
export const BILLING_METER_DISPATCH_SUPPRESS_MS = 300_000;

/**
 * One queue lane per project, matching this reactor's per-project dedup id.
 *
 * The queue's dedup key is global to the queue, but the check that decides
 * whether a duplicate is still squashable looks the existing job up in the
 * CURRENT group's job set. So a dedup id that spans groups never squashes:
 * the lookup misses, the key is treated as stale, and it is deleted before a
 * fresh job stages — which also drops the guard protecting the pending job in
 * the other group. A per-project dedup id therefore only bites under a
 * per-project lane, and inheriting the default per-trace lane silently turns
 * the dedup into a no-op that leaves one live job per concurrent trace.
 *
 * Nothing here reads the triggering event: the dispatch is derived from the
 * project's organization and the current billing month, so every one of a
 * project's jobs is interchangeable and they belong in one serialized lane.
 * The queue prefixes `<tenantId>/map/orgBillableEventsMeter/reactor/
 * billingMeterDispatch/` around this key.
 */
export function billingMeterDispatchGroupKey(event: {
  tenantId: string;
}): string {
  return `billing-meter-dispatch:${event.tenantId}`;
}

/**
 * Reactor that dispatches billing usage reporting commands after
 * the orgBillableEventsMeter map projection succeeds.
 *
 * Two dedup layers:
 * - Reactor-level per-project: makeJobId creates one reactor job per project,
 *   collapsed into one pending job by the per-project lane above.
 *   An org with N active projects creates N reactor jobs but each project
 *   only triggers one within the TTL window.
 * - Framework per-org: command dedup via makeId `${orgId}:${billingMonth}`, 310s TTL
 *   ensures only one reporting command per org per month is pending.
 *
 * Grace period: during the first 3 days of a month, dispatches for both
 * current and previous billing month to catch late-arriving events.
 */
export function createBillingMeterDispatchReactor(deps: {
  getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>;
}): ReactorDefinition<Event> {
  return {
    name: "billingMeterDispatch",
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => billingMeterDispatchGroupKey(payload.event),
      // The only reactor here that may keep suppressing after it fires. The
      // handler reads nothing from the event it was handed — it resolves the
      // org and the current billing month from the clock — so every trigger
      // in the window is genuinely the same work, and discarding the later
      // ones cannot strand any state. That makes the per-project suppression
      // this reactor always documented finally take effect: without it the
      // dedup key is dropped the moment the job dispatches and the very next
      // event re-triggers.
      //
      // The lane above and the window here are the two halves of one
      // behaviour: the lane lets a project's concurrent traces share a dedup
      // key at all, the window gives that key long enough to collapse them.
      ...throttledPerWindow({
        makeJobId: (payload) => `billing_dispatch_${payload.event.tenantId}`,
        windowMs: BILLING_METER_DISPATCH_WINDOW_MS,
        dedupTtlMs: BILLING_METER_DISPATCH_SUPPRESS_MS,
        surviveDispatch: true,
      }),
    },

    async handle(event, context) {
      const orgId = await resolveOrganizationId(context.tenantId);

      if (!orgId) {
        logger.warn(
          { projectId: context.tenantId },
          "orphan project detected, has no organization -- skipping billing dispatch",
        );
        return;
      }

      const now = new Date();
      const billingMonth = getBillingMonth(now);

      try {
        const dispatch = deps.getDispatch();

        // Grace period: dispatch for previous month during first days of a new month
        if (now.getUTCDate() <= GRACE_PERIOD_DAYS) {
          const prevMonth = getPreviousBillingMonth(now);
          await dispatch({
            organizationId: orgId,
            billingMonth: prevMonth,
            tenantId: orgId,
            occurredAt: Date.now(),
          });
        }

        // Always dispatch for current month
        await dispatch({
          organizationId: orgId,
          billingMonth,
          tenantId: orgId,
          occurredAt: Date.now(),
        });
      } catch (error) {
        logger.warn(
          { organizationId: orgId, error },
          "failed to dispatch usage reporting command, events are safe in ClickHouse",
        );
      }
    },
  };
}
