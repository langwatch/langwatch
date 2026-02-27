import { definePipeline } from "../../";
import type { Event } from "../../domain/types";

export interface BillingReportingPipelineDeps {
  ReportUsageForMonthCommand: {
    new (): any;
    readonly schema: any;
    getAggregateId(payload: any): string;
    getSpanAttributes?(
      payload: any,
    ): Record<string, string | number | boolean>;
  };
}

/**
 * Creates the billing-reporting pipeline definition.
 *
 * Command-only pipeline — no projections, no reactors.
 * The reactor that dispatches commands lives in the global ProjectionRegistry
 * (registered via EventSourcing.registerGlobalReactor from PipelineRegistry).
 */
export function createBillingReportingPipeline(
  deps: BillingReportingPipelineDeps,
) {
  return definePipeline<Event>()
    .withName("billing_reporting")
    .withAggregateType("billing_report")
    .withCommand("reportUsageForMonth", deps.ReportUsageForMonthCommand, {
      delay: 300_000, // 5 min delay (initial + re-trigger)
      deduplication: {
        makeId: (p: { organizationId: string; billingMonth: string }) =>
          `${p.organizationId}:${p.billingMonth}`,
        ttlMs: 310_000, // 310s > 300s delay — prevents thundering herd, self-dispatch still works via replace logic
      },
    })
    .build();
}
