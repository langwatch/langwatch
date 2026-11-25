import {
  BILLING_REPORTING_PIPELINE_NAME,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  monthCountedEventDataSchema,
  USAGE_MONTH_COUNTED_EVENT_TYPE,
  USAGE_THRESHOLD_CROSSED_EVENT_TYPE,
  usageThresholdCrossedEventDataSchema,
} from "@langwatch/entitlement-contract";
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingParticipation,
  type EventingSetup,
  type Projection,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";

import type { BillingModule } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import type { UsageWarningService } from "../services/usage-warning.service.ts";
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

/** The peer subscriber that reports each month usage counts. */
export const BILLING_MONTH_COUNTED_SUBSCRIBER_NAME = "usageMonthCounted";

/** The peer subscriber that mails each usage threshold entitlement records. */
export const BILLING_USAGE_THRESHOLD_CROSSED_SUBSCRIBER_NAME = "usageThresholdCrossed";

type BillingReportingDeps = Omit<ReportUsageForMonthCommandDeps, "selfDispatch"> & {
  /** Skips a threshold already mailed this month, so a redelivered event mails nobody twice. */
  usageWarnings: Pick<UsageWarningService, "send">;
};

/**
 * The monthly roll-up's pipeline. The self-dispatch loop closes at registration,
 * not at first dispatch; usage's month_counted starts each month's report.
 */
export class BillingReportingPipeline {
  static create(deps: BillingReportingDeps): BillingReportingPipeline {
    return new BillingReportingPipeline(deps);
  }

  private send: ((data: ReportUsageForMonthCommandData) => Promise<void>) | undefined;

  private constructor(private readonly deps: BillingReportingDeps) {}

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
    const { usageWarnings, ...report } = this.deps;
    if (participation === "consume") report.getUsageReportingService();
    const reportUsageForMonthCommand = ReportUsageForMonthCommandHandler.create({
      ...report,
      selfDispatch: (data) => this.dispatch(data),
    });

    return definePipeline({
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
            // Keyed by the counted event too: a retry replaces only its own job.
            makeId: (p: ReportUsageForMonthCommandData) =>
              [p.organizationId, p.billingMonth, p.countedEventId].filter(Boolean).join(":"),
            ttlMs: 310_000, // 310s > 300s delay
          },
        },
      })
      .withPeerSubscriber(BILLING_MONTH_COUNTED_SUBSCRIBER_NAME, {
        eventType: USAGE_MONTH_COUNTED_EVENT_TYPE,
        data: monthCountedEventDataSchema,
        handle: (data, { eventId }) =>
          this.dispatch({
            organizationId: data.organizationId,
            billingMonth: data.month,
            tenantId: data.organizationId,
            occurredAt: data.occurredAt,
            billableEvents: data.billableEvents,
            countedEventId: eventId,
          }),
      })
      .withPeerSubscriber(BILLING_USAGE_THRESHOLD_CROSSED_SUBSCRIBER_NAME, {
        eventType: USAGE_THRESHOLD_CROSSED_EVENT_TYPE,
        data: usageThresholdCrossedEventDataSchema,
        handle: async (data) => {
          await usageWarnings.send(data);
        },
      })
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
  build: ({ app, participation }: EventingSetup<BillingRepositories, BillingModule>) =>
    app.reportingPipeline({ participation }),
  connect: ({ app, commands }) => app.connectReporting(commands.reportUsageForMonth),
});
