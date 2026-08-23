import type { Event, SubscriberDispatchDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { resolveOrganizationId } from "~/server/organizations/resolveOrganizationId";
import {
  getBillingMonth,
  getPreviousBillingMonth,
} from "../../../../../ee/billing/services/billableEventsQuery";
import type { ReportUsageForMonthCommandData } from "../../pipelines/billing-reporting/schemas/commands";

const logger = createLogger("langwatch:billing:meterDispatch");

/** Number of days at the start of a new month to also check the previous month. */
const GRACE_PERIOD_DAYS = 3;

/**
 * How long a project's dedup key lives. Sized to the downstream command's own
 * dedup window so the two agree on the rate.
 */
export const BILLING_METER_DISPATCH_SUPPRESS_MS = 300_000;

/**
 * One queue lane per project, matching this subscriber's per-project dedup id.
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
 * Subscriber that dispatches billing usage reporting commands after
 * the orgBillableEventsMeter map projection succeeds.
 *
 * Two dedup layers:
 * - Subscriber-level per-project: makeJobId creates one job per project,
 *   collapsed into one pending job by the per-project lane above.
 *   An org with N active projects creates N jobs but each project
 *   only triggers one within the TTL window.
 * - Framework per-org: command dedup via makeId `${orgId}:${billingMonth}`, 310s TTL
 *   ensures only one reporting command per org per month is pending.
 *
 * Grace period: during the first 3 days of a month, dispatches for both
 * current and previous billing month to catch late-arriving events.
 */
export function createBillingMeterDispatchSubscriber(deps: {
  getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>;
}): SubscriberDispatchDefinition<Event> {
  return {
    name: "billingMeterDispatch",
    options: {
      runIn: ["worker"],
      groupKeyFn: (payload) => billingMeterDispatchGroupKey(payload.event),
      // Deliberately fires immediately, unlike the other level-triggered
      // subscribers. `handle` decides which billing months to report by reading
      // the WALL CLOCK at the moment it runs, not the event it was given, so
      // holding a trigger moves the decision as well as the work. A trigger
      // arriving in the last seconds of the third grace day would run on the
      // fourth and silently drop the previous month's dispatch — a missed
      // report rather than a late one, since the next grace window covers a
      // different month.
      //
      // A window here is safe once the month and grace decision come from the
      // triggering event instead of the clock. Until then this subscriber relies
      // on the per-project lane above, which collapses a project's concurrent
      // traces without deferring anything.
      makeJobId: (payload) => `billing_dispatch_${payload.event.tenantId}`,
      ttl: BILLING_METER_DISPATCH_SUPPRESS_MS,
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
