import {
  BILLING_REPORTING_PIPELINE_NAME,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type Event,
  type StaticPipelineDefinition,
  type Projection,
  type RegisteredCommand,
} from "@langwatch/eventing";

import {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "./report-usage-for-month.commands.ts";

/**
 * Command-only billing pipeline. selfDispatch loop closes at registration
 * time, not at first dispatch, to catch misconfiguration at boot.
 */
export class BillingReportingPipeline {
  static create(
    deps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch">,
  ): BillingReportingPipeline {
    return new BillingReportingPipeline(deps);
  }

  private send: ((data: ReportUsageForMonthCommandData) => Promise<void>) | undefined;

  private constructor(
    private readonly deps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch">,
  ) {}

  buildProcessing(): StaticPipelineDefinition<
    Event,
    Record<string, Projection>,
    RegisteredCommand
  > {
    const reportUsageForMonthCommand = ReportUsageForMonthCommandHandler.create({
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
        ReportUsageForMonthCommandHandler,
        reportUsageForMonthCommand,
        {
          delay: 300_000, // 5 min delay (initial + re-trigger)
          deduplication: {
            makeId: (p: { organizationId: string; billingMonth: string }) =>
              `${p.organizationId}:${p.billingMonth}`,
            ttlMs: 310_000, // 310s > 300s delay; replace preserves self-dispatch
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
