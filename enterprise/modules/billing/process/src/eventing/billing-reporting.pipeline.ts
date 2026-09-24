import {
  BILLING_REPORTING_PIPELINE_NAME,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type Event,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingApp } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "./report-usage-for-month.commands.ts";

/** The roll-up's one command, typed so the registered sender keeps its payload. */
export type BillingReportingDefinition = StaticPipelineDefinition<
  Event,
  Record<string, Projection>,
  { name: "reportUsageForMonth"; payload: ReportUsageForMonthCommandData }
>;

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

  buildProcessing(): BillingReportingDefinition {
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

    return definePipeline({
      name: BILLING_REPORTING_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: "billing_report",
      }),
    })
      .withEvents([])
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

export const billingReportingEventing = defineEventingModule({
  pipeline: BILLING_REPORTING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<BillingRepositories, BillingApp>) => app.reportingPipeline(),
  connect: ({ app, commands }) => app.connectReporting(commands.reportUsageForMonth),
});
