// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { Event, SubscriberDispatchDefinition } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { ReportUsageForMonthCommandData } from "@langwatch/enterprise-billing-contract";
import { BillableEventsQueryService } from "../services/billable-events-query.service";
import type { BillingTenantOrganizationService } from "../services/tenant-organization.service";

const logger = createLogger("langwatch:billing:meterDispatch");

/**
 * The subscriber's name, and the suppression window its job id lives for.
 *
 * Frozen twins: `billingMeterDispatch.subscriber.ts` in the App declares the
 * identical pair. The name is half of the routing key
 * `global:reactor:billingMeterDispatch`, which both graphs register into one
 * `event-sourcing/jobs` queue, and the TTL is sized to the downstream
 * command's own deduplication window so the two agree on the rate. They may
 * only change together.
 */
export const BILLING_METER_DISPATCH_SUBSCRIBER_NAME = "billingMeterDispatch";
export const BILLING_METER_DISPATCH_SUPPRESS_MS = 300_000;

/** Days into a new month during which the previous month is still reported. */
const GRACE_PERIOD_DAYS = 3;

/**
 * Dispatches the monthly usage-reporting command after the billable-events
 * meter records an event.
 *
 * Two deduplication layers:
 * - Subscriber-level per-project: one job per project, collapsed into one
 *   pending job by the per-project lane above. An organization with N active
 *   projects creates N jobs, but each project only triggers one within the
 *   suppression window.
 * - Framework per-organization: the command's own `${orgId}:${billingMonth}`
 *   deduplication keeps one reporting command per organization per month
 *   pending.
 *
 * Grace window: during the first three days of a month this also dispatches
 * for the previous month, so events that arrive late are still reported
 * against the month they belong to.
 */
export class EventingBillingMeterDispatchAdapter {
  static create(options: {
    organizations: BillingTenantOrganizationService;
    /**
     * Resolved when a billable event is dispatched rather than when this is
     * built: the pipeline that answers it is registered by the very
     * composition this subscriber is configured on, so nothing here can hold a
     * direct handle.
     */
    getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>;
    /** Injected so a test can place the run inside or outside the grace window. */
    now?: () => Date;
  }): EventingBillingMeterDispatchAdapter {
    return new EventingBillingMeterDispatchAdapter(
      options.organizations,
      options.getDispatch,
      options.now ?? (() => new Date()),
    );
  }

  private constructor(
    private readonly organizations: BillingTenantOrganizationService,
    private readonly getDispatch: () => (data: ReportUsageForMonthCommandData) => Promise<void>,
    private readonly now: () => Date,
  ) {}

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
  static groupKey(event: { tenantId: string }): string {
    return `billing-meter-dispatch:${event.tenantId}`;
  }

  /** The per-project deduplication id one suppression window collapses onto. */
  static jobId(event: { tenantId: string }): string {
    return `billing_dispatch_${event.tenantId}`;
  }

  build(): SubscriberDispatchDefinition<Event> {
    return {
      name: BILLING_METER_DISPATCH_SUBSCRIBER_NAME,
      options: {
        runIn: ["worker"],
        groupKeyFn: (payload) => EventingBillingMeterDispatchAdapter.groupKey(payload.event),
        // Deliberately fires immediately, unlike the other level-triggered
        // subscribers. `handle` decides which billing months to report by
        // reading the WALL CLOCK at the moment it runs, not the event it was
        // given, so holding a trigger moves the decision as well as the work. A
        // trigger arriving in the last seconds of the third grace day would run
        // on the fourth and silently drop the previous month's dispatch — a
        // missed report rather than a late one, since the next grace window
        // covers a different month.
        //
        // A window here is safe once the month and grace decision come from the
        // triggering event instead of the clock. Until then this subscriber
        // relies on the per-project lane above, which collapses a project's
        // concurrent traces without deferring anything.
        makeJobId: (payload) => EventingBillingMeterDispatchAdapter.jobId(payload.event),
        ttl: BILLING_METER_DISPATCH_SUPPRESS_MS,
      },

      handle: async (_event, context) => {
        const organizationId = await this.organizations.tryResolveOrganizationId(context.tenantId);
        if (!organizationId) return;

        const now = this.now();
        try {
          const dispatch = this.getDispatch();

          if (now.getUTCDate() <= GRACE_PERIOD_DAYS) {
            await dispatch({
              organizationId,
              billingMonth: BillableEventsQueryService.getPreviousBillingMonth(now),
              tenantId: organizationId,
              occurredAt: Date.now(),
            });
          }

          await dispatch({
            organizationId,
            billingMonth: BillableEventsQueryService.getBillingMonth(now),
            tenantId: organizationId,
            occurredAt: Date.now(),
          });
        } catch (error) {
          logger.warn(
            { organizationId, error },
            "failed to dispatch usage reporting command, events are safe in ClickHouse",
          );
        }
      },
    };
  }
}
