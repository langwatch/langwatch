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
  type QueueSendOptions,
  type StaticPipelineDefinition,
} from "@langwatch/eventing";
import {
  GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
  gatewaySpendConfirmedEventDataSchema,
} from "@langwatch/gateway-contract";

import type { BillingModule } from "../app/billing.app.ts";
import type { BillingRepositories } from "../repositories/billing.repositories.ts";
import { isMeteredSpend, spendReportOf } from "../rules/metered-spend-report.rules.ts";
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

/** The peer subscriber that reports the month of confirmed metered spend (ADR-174 decision 20). */
export const BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME = "gatewaySpendConfirmed";

/** How long a report waits before it runs, so a burst collapses into one. */
export const REPORT_DELAY_MS = 300_000;

/** How long a spend report's one follow-up waits, for a spend row still being written. */
const SPEND_FOLLOW_UP_DELAY_MS = 900_000;

/** One queued report per key; a spend report's follow-up keeps a key of its own. */
export function reportDedupId(data: ReportUsageForMonthCommandData): string {
  const followUp = data.trigger === "spend_follow_up" ? "spend_follow_up" : undefined;
  return [data.organizationId, data.billingMonth, data.countedEventId, followUp]
    .filter(Boolean)
    .join(":");
}

/** The follow-up's send: a longer delay, and a dedupe window that outlasts it. */
const SPEND_FOLLOW_UP_SEND: QueueSendOptions<ReportUsageForMonthCommandData> = {
  delay: SPEND_FOLLOW_UP_DELAY_MS,
  deduplication: { makeId: reportDedupId, ttlMs: SPEND_FOLLOW_UP_DELAY_MS + 10_000 },
};

/** A spend report's send: a spend arriving while one waits joins it, never pushes it later. */
const SPEND_REPORT_SEND: QueueSendOptions<ReportUsageForMonthCommandData> = {
  delay: REPORT_DELAY_MS,
  deduplication: { makeId: reportDedupId, ttlMs: REPORT_DELAY_MS + 10_000, extend: false },
};

type ReportSender = (
  data: ReportUsageForMonthCommandData,
  options?: QueueSendOptions<ReportUsageForMonthCommandData>,
) => Promise<void>;

type BillingReportingDeps = Omit<ReportUsageForMonthCommandDeps, "selfDispatch"> & {
  /** Skips a threshold already mailed this month, so a redelivered event mails nobody twice. */
  usageWarnings: Pick<UsageWarningService, "send">;
};

/**
 * The monthly roll-up's pipeline. The self-dispatch loop closes at registration,
 * not at first dispatch; usage's month_counted and gateway's metered spend start a report.
 */
export class BillingReportingPipeline {
  static create(deps: BillingReportingDeps): BillingReportingPipeline {
    return new BillingReportingPipeline(deps);
  }

  private send: ReportSender | undefined;

  private constructor(private readonly deps: BillingReportingDeps) {}

  private dispatch(data: ReportUsageForMonthCommandData): Promise<void> {
    if (!this.send) {
      throw new Error("Billing reporting cannot self-dispatch before its pipeline is registered.");
    }
    if (data.trigger === "spend_follow_up") return this.send(data, SPEND_FOLLOW_UP_SEND);
    if (data.trigger === "spend_confirmed") return this.send(data, SPEND_REPORT_SEND);
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
          delay: REPORT_DELAY_MS,
          deduplication: {
            // Keyed by the counted event too: a retry replaces only its own job.
            makeId: reportDedupId,
            ttlMs: REPORT_DELAY_MS + 10_000,
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
      .withPeerSubscriber(BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME, {
        eventType: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
        data: gatewaySpendConfirmedEventDataSchema,
        options: { enqueue: { filter: (spend) => isMeteredSpend({ spend }) } },
        handle: async (spend) => {
          if (isMeteredSpend({ spend })) await this.dispatch(spendReportOf({ spend }));
        },
      })
      .build();
  }

  connectSelfDispatch(sendReportUsageForMonth: ReportSender): void {
    this.send = sendReportUsageForMonth;
  }
}

export const billingReportingEventing = defineEventingModule({
  pipeline: BILLING_REPORTING_PIPELINE_NAME,
  build: ({ app, participation }: EventingSetup<BillingRepositories, BillingModule>) =>
    app.reportingPipeline({ participation }),
  connect: ({ app, commands }) => app.connectReporting(commands.reportUsageForMonth),
});
