import {
  BILLING_REPORTING_PIPELINE_NAME,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingParticipation,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingApp } from "../app/billing.app.ts";
import type { BillableEventsMeterRepository } from "../repositories/billable-events-meter.repository.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import type { BillingTenantOrganizationService } from "../services/tenant-organization.service.ts";
import { BillableEventsMeterProjection } from "./billable-events-meter.projection.ts";
import { BillingMeterDispatchSubscriber } from "./billing-meter-dispatch.subscriber.ts";
import {
  ReportUsageForMonthCommandHandler,
  type ReportUsageForMonthCommandDeps,
} from "./report-usage-for-month.commands.ts";

/** The roll-up's one command, typed so the registered sender keeps its payload. */
export type BillingReportingDefinition = StaticPipelineDefinition<
  never,
  Record<string, Projection>,
  { name: "reportUsageForMonth"; payload: ReportUsageForMonthCommandData }
>;

/** The SaaS billable-events meter and the tenant attribution it bills by. */
export type BillingReportingMeter = Readonly<{
  meter: BillableEventsMeterRepository;
  organizations: BillingTenantOrganizationService;
}>;

/**
 * The monthly roll-up's pipeline. The self-dispatch loop closes at registration,
 * not at first dispatch; on SaaS it also declares the billable-events meter, whose
 * dispatch subscriber reports through the same command (main registered it on SaaS only).
 */
export class BillingReportingPipeline {
  static create({
    meter,
    ...deps
  }: Omit<ReportUsageForMonthCommandDeps, "selfDispatch"> & {
    meter?: BillingReportingMeter | undefined;
  }): BillingReportingPipeline {
    return new BillingReportingPipeline(deps, meter);
  }

  private send: ((data: ReportUsageForMonthCommandData) => Promise<void>) | undefined;

  private constructor(
    private readonly deps: Omit<ReportUsageForMonthCommandDeps, "selfDispatch">,
    private readonly meter: BillingReportingMeter | undefined,
  ) {}

  private dispatch(data: ReportUsageForMonthCommandData): Promise<void> {
    if (!this.send) {
      throw new Error("Billing reporting cannot self-dispatch before its pipeline is registered.");
    }
    return this.send(data);
  }

  /** The worker resolves the reporter now, so a keyless SaaS worker refuses at boot, as on main. */
  buildProcessing({
    participation,
  }: {
    participation: EventingParticipation;
  }): BillingReportingDefinition {
    if (participation === "consume") this.deps.getUsageReportingService();
    const reportUsageForMonthCommand = ReportUsageForMonthCommandHandler.create({
      ...this.deps,
      selfDispatch: (data) => this.dispatch(data),
    });

    const pipeline = definePipeline({
      name: BILLING_REPORTING_PIPELINE_NAME,
      aggregate: defineAggregate({
        type: "billing_report",
      }),
    })
      .withEvents([])
      .withCommandInstance({
        name: "reportUsageForMonth",
        handlerClass: ReportUsageForMonthCommandHandler,
        instance: reportUsageForMonthCommand,
        options: {
          delay: 300_000, // 5 min delay (initial + re-trigger)
          deduplication: {
            makeId: (p: { organizationId: string; billingMonth: string }) =>
              `${p.organizationId}:${p.billingMonth}`,
            ttlMs: 310_000, // 310s > 300s delay; replace preserves self-dispatch
          },
        },
      });
    if (!this.meter) return pipeline.build();
    return pipeline
      .withGlobalMapProjection(BillableEventsMeterProjection.create(this.meter).build(), [
        BillingMeterDispatchSubscriber.create({
          organizations: this.meter.organizations,
          getDispatch: () => (data) => this.dispatch(data),
        }).build(),
      ])
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
  build: ({ app, participation }: EventingSetup<BillingRepositories, BillingApp>) =>
    app.reportingPipeline({ participation }),
  connect: ({ app, commands }) => app.connectReporting(commands.reportUsageForMonth),
});
