import { defineAggregate, defineEvents, definePipeline, type Event } from "@langwatch/eventing";
import {
  BILLING_REPORTING_PIPELINE_NAME,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  EventingReportUsageForMonthAdapter,
  type ReportUsageForMonthCommandDeps,
} from "./eventing.report-usage-for-month.adapter";

/**
 * Billing reporting's Eventing graph, and the worker-facing capability that
 * composes it.
 *
 * Command-only pipeline — no projections, no subscribers. The subscriber that
 * dispatches into it is the global billable-events meter, registered on the
 * EventSourcing runtime itself rather than on a pipeline.
 *
 * `selfDispatch` is the loop this feature cannot close alone: the command
 * re-dispatches itself to walk a month forward, so the sender it needs is
 * produced by the very registration that consumes it. The legacy registry
 * closed that loop by looking the pipeline up by name at dispatch time.
 * Binding it once, straight after registration, moves a mis-registered graph's
 * failure from the first monthly roll-up to boot.
 */
export class EventingBillingReportingAdapter {
  static create(
    deps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch">,
  ): EventingBillingReportingAdapter {
    return new EventingBillingReportingAdapter(deps);
  }

  private send: ((data: ReportUsageForMonthCommandData) => Promise<void>) | undefined;

  private constructor(
    private readonly deps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch">,
  ) {}

  buildProcessing() {
    const reportUsageForMonthCommand = EventingReportUsageForMonthAdapter.create({
      ...this.deps,
      selfDispatch: (data) => {
        if (!this.send) {
          throw new Error(
            "Billing reporting cannot self-dispatch before its pipeline is registered.",
          );
        }
        return this.send(data);
      },
    });

    return definePipeline<Event>({
      name: BILLING_REPORTING_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: "billing_report",
        events: defineEvents([]),
      }),
    })
      .withCommandInstance(
        "reportUsageForMonth",
        EventingReportUsageForMonthAdapter,
        reportUsageForMonthCommand,
        {
          delay: 300_000, // 5 min delay (initial + re-trigger)
          deduplication: {
            makeId: (p: { organizationId: string; billingMonth: string }) =>
              `${p.organizationId}:${p.billingMonth}`,
            ttlMs: 310_000, // 310s > 300s delay — prevents thundering herd, self-dispatch still works via replace logic
          },
        },
      )
      .build();
  }

  connectSelfDispatch(
    sendReportUsageForMonth: (data: ReportUsageForMonthCommandData) => Promise<void>,
  ): void {
    this.send = sendReportUsageForMonth;
  }
}
