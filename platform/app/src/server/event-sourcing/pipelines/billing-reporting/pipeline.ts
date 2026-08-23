import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type Event,
} from "@langwatch/eventing";
import { ReportUsageForMonthCommand } from "./commands/reportUsageForMonth.command";

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

export interface BillingReportingPipelineDeps {
  reportUsageForMonthCommand: ReportUsageForMonthCommand;
}

/**
 * Creates the billing-reporting pipeline definition.
 *
 * Command-only pipeline — no projections, no subscribers.
 * The subscriber that dispatches commands is registered in the EventSourcing
 * constructor alongside the global fold and map projections.
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  return definePipeline<Event>({
    name: BILLING_REPORTING_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: "billing_report",
      events: defineEvents([]),
    }),
  })
    .withCommandInstance(
      "reportUsageForMonth",
      ReportUsageForMonthCommand,
      deps.reportUsageForMonthCommand,
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
