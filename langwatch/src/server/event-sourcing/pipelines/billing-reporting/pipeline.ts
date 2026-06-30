import { definePipeline } from "../../";
import type { Event } from "../../domain/types";
import { ReportStorageForHourCommand } from "./commands/reportStorageForHour.command";
import { ReportUsageForMonthCommand } from "./commands/reportUsageForMonth.command";

export const BILLING_REPORTING_PIPELINE_NAME = "billing_reporting" as const;

export interface BillingReportingPipelineDeps {
  reportUsageForMonthCommand: ReportUsageForMonthCommand;
  reportStorageForHourCommand: ReportStorageForHourCommand;
}

/**
 * Creates the billing-reporting pipeline definition.
 *
 * Command-only pipeline — no projections, no reactors.
 * The reactor that dispatches commands is registered in the EventSourcing
 * constructor alongside the global fold and map projections.
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  return definePipeline<Event>()
    .withName(BILLING_REPORTING_PIPELINE_NAME)
    .withAggregateType("billing_report")
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
    .withCommandInstance(
      "reportStorageForHour",
      ReportStorageForHourCommand,
      deps.reportStorageForHourCommand,
      {
        delay: 300_000, // 5 min backoff between a transient failure and its self-dispatched retry
        deduplication: {
          // Per (org, hour): each sealed hour is reported independently, and a
          // replay-driven re-dispatch of the same hour coalesces.
          makeId: (p: { organizationId: string; sealedHour: string }) =>
            `${p.organizationId}:${p.sealedHour}`,
          ttlMs: 310_000, // 310s > 300s delay — same sizing as the month command
        },
      },
    )
    .build();
}
