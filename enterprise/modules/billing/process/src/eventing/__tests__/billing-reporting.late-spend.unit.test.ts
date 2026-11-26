/**
 * Spend confirmed after a month's last trace still reaches Stripe (ADR-174 decision 20).
 * @see enterprise/modules/billing/specs/late-metered-spend.feature
 */
import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  BILLING_REPORT_COMMAND_TYPES,
  type ReportUsageForMonthCommandData,
} from "@langwatch/enterprise-billing-contract";
import {
  createTenantId,
  type Event,
  type EventSubscriberDefinition,
  type QueueSendOptions,
} from "@langwatch/eventing";
import { GATEWAY_SPEND_CONFIRMED_EVENT_TYPE } from "@langwatch/gateway-contract";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import { INSTANT_EVAL_USD_EVENT_NAME } from "../../rules/instant-eval-meter.rules.ts";
import { PII_REDACTION_USD_EVENT_NAME } from "../../rules/pii-redaction-meter.rules.ts";
import { BillingErrorReporterService } from "../../services/billing-error-reporter.service.ts";
import type { UsageReportingService } from "../../services/usage-reporting.service.ts";
import type { UsageWarningService } from "../../services/usage-warning.service.ts";
import {
  BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME,
  BillingReportingPipeline,
  REPORT_DELAY_MS,
  reportDedupId,
} from "../billing-reporting.pipeline.ts";
import { ReportUsageForMonthCommandHandler } from "../report-usage-for-month.commands.ts";

const ORG = "org_1";
const SPEND_LANE = `billing_reporting.${BILLING_SPEND_CONFIRMED_SUBSCRIBER_NAME}`;
const MID_OCTOBER = Date.UTC(2026, 9, 15, 12);

type Sent = {
  data: ReportUsageForMonthCommandData;
  options: QueueSendOptions<ReportUsageForMonthCommandData> | undefined;
};

const USAGE_BILLED: BillingReportOrganizationLookup = {
  outcome: "usage_billed",
  organization: {
    id: ORG,
    stripeCustomerId: "cus_1",
    subscriptions: [{ id: "sub_1" }],
    contract: "cloud",
    growthSeatPeriods: [],
  },
};

/**
 * The roll-up composed as the worker composes it, over a ledger the test moves. Every send
 * lands in `sent`, with the options the queue would get.
 */
function rollUp({
  lookup = async () => USAGE_BILLED,
  ledger = { instantEval: 0, piiRedaction: 0 },
  send,
}: {
  lookup?: () => Promise<BillingReportOrganizationLookup>;
  ledger?: { instantEval: number; piiRedaction: number };
  send?: (sent: Sent) => Promise<void>;
} = {}) {
  const repositories = MemoryBillingRepositories.create();
  const meterEvents: { eventName: string; value: number }[] = [];
  const reporter = createApiFixture<UsageReportingService>({
    reportUsageDelta: async ({ events }) =>
      events.map((event) => {
        meterEvents.push({ eventName: event.eventName, value: event.value });
        return { identifier: event.identifier, reported: true, valueSent: event.value };
      }),
  });
  const pipeline = BillingReportingPipeline.create({
    usageWarnings: createApiFixture<UsageWarningService>({}),
    organizations: { getOrganizationForBilling: lookup },
    billingCheckpoints: repositories.checkpoints,
    getUsageReportingService: () => reporter,
    queryInstantEvalSpendTotal: async () => ({ outcome: "counted", total: ledger.instantEval }),
    isInstantEvalMeterProvisioned: () => true,
    queryPiiRedactionSpendTotal: async () => ({ outcome: "counted", total: ledger.piiRedaction }),
    isPiiRedactionMeterProvisioned: () => true,
    subscriptionPriceLine: async () => ({ carried: true, addedAtMs: null }),
    organizationCache: repositories.organizationCache,
    errorReporter: BillingErrorReporterService.create(),
    connectedUsageCeiling: async () => null,
  });
  const definition = pipeline.buildProcessing({ participation: "consume" });
  const sent: Sent[] = [];
  pipeline.connectSelfDispatch(async (data, options) => {
    sent.push({ data, options });
    await send?.({ data, options });
  });
  const subscribers: EventSubscriberDefinition<Event>[] = [];
  const registry = createApiFixture<
    Parameters<NonNullable<typeof definition.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void subscribers.push(subscriber),
  });
  for (const projection of definition.globalProjections ?? []) projection.register(registry);
  const spendSubscriber = subscribers.find(({ name }) => name === SPEND_LANE);
  const handler = definition.commands[0]?.open<unknown>((command) => command.createHandler());
  if (!(handler instanceof ReportUsageForMonthCommandHandler)) {
    throw new Error("the roll-up registers no report handler");
  }
  return {
    definition,
    subscribers,
    sent,
    meterEvents,
    checkpoints: repositories.checkpoints,
    receive: async (event: Event) => {
      if (!spendSubscriber) throw new Error(`no subscriber on ${SPEND_LANE}`);
      await spendSubscriber.handle(event, {
        tenantId: event.tenantId,
        aggregateId: event.aggregateId,
      });
    },
    run: (data: ReportUsageForMonthCommandData) =>
      handler.handle({
        tenantId: createTenantId(data.tenantId),
        aggregateId: data.organizationId,
        type: BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
        data,
      }),
  };
}

function spendConfirmed({
  requestType = INSTANT_EVAL_REQUEST_TYPE,
  organizationId = ORG,
  occurredAt = MID_OCTOBER,
}: { requestType?: string; organizationId?: string; occurredAt?: number } = {}): Event {
  return {
    id: `evt_spend_${occurredAt}`,
    aggregateId: "gwreq_1",
    aggregateType: "gateway_spend",
    tenantId: createTenantId("project_1"),
    createdAt: occurredAt,
    occurredAt,
    type: GATEWAY_SPEND_CONFIRMED_EVENT_TYPE,
    version: "2026-01-01",
    data: {
      gateway_request_id: "gwreq_1",
      occurred_at: occurredAt,
      tenantId: "project_1",
      organization_id: organizationId,
      request_type: requestType,
      cost_nano_usd: 1_000_000,
      usage: {},
    },
  };
}

const spendReport = (billingMonth = "2026-10"): ReportUsageForMonthCommandData => ({
  organizationId: ORG,
  billingMonth,
  tenantId: ORG,
  occurredAt: MID_OCTOBER,
  trigger: "spend_confirmed",
});

describe("billing's report of spend confirmed after a month's last trace", () => {
  describe("given the roll-up's eventing declaration", () => {
    /** @scenario "Billing subscribes to gateway's confirmed spend" */
    it("registers one peer subscriber on gateway's confirmed spend", () => {
      const { subscribers } = rollUp();

      const onSpend = subscribers.filter(({ eventTypes }) =>
        eventTypes.includes(GATEWAY_SPEND_CONFIRMED_EVENT_TYPE),
      );
      expect(onSpend.map(({ name }) => name)).toEqual([SPEND_LANE]);
    });
  });

  describe("when gateway confirms metered spend", () => {
    /** @scenario "A confirmed Instant Evals spend dispatches the report for its organization and month" */
    it("dispatches the month's report for an instant_eval spend", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed({ requestType: INSTANT_EVAL_REQUEST_TYPE }));

      expect(billing.sent.map(({ data }) => data)).toEqual([spendReport()]);
    });

    /** @scenario "A confirmed PII redaction spend dispatches the report for its organization and month" */
    it("dispatches the month's report for a pii_redaction spend", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed({ requestType: PII_REDACTION_REQUEST_TYPE }));

      expect(billing.sent.map(({ data }) => data)).toEqual([spendReport()]);
    });

    /** @scenario "The month is the UTC month the spend occurred in" */
    it("reports the UTC month of occurred_at on either side of midnight", async () => {
      const billing = rollUp();
      const lastOfOctober = Date.UTC(2026, 10, 1) - 1;

      await billing.receive(spendConfirmed({ occurredAt: lastOfOctober }));
      await billing.receive(spendConfirmed({ occurredAt: lastOfOctober + 1 }));

      expect(billing.sent.map(({ data }) => data.billingMonth)).toEqual(["2026-10", "2026-11"]);
    });

    /** @scenario "A spend report leaves the events meter on its own cursor" */
    it("carries no events total or counted event, and the events meter sends nothing", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed());
      const [report] = billing.sent;
      expect(report?.data).not.toHaveProperty("billableEvents");
      expect(report?.data).not.toHaveProperty("countedEventId");

      await billing.run(report!.data);

      expect(billing.meterEvents.map(({ eventName }) => eventName)).not.toContain(
        "langwatch_billable_events",
      );
      expect(
        await billing.checkpoints.findCheckpoint({
          organizationId: ORG,
          billingMonth: "2026-10",
          meter: "langwatch_billable_events",
        }),
      ).toBeNull();
    });

    /** @scenario "A burst of spend for one organization and month is one report" */
    it("gives every spend report of the month one dedupe key and the report's usual delay", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed({ occurredAt: MID_OCTOBER }));
      await billing.receive(spendConfirmed({ occurredAt: MID_OCTOBER + 60_000 }));

      const keys = billing.sent.map(({ data }) => reportDedupId(data));
      expect(new Set(keys)).toEqual(new Set([`${ORG}:2026-10`]));
      for (const { data, options } of billing.sent) {
        expect(options?.delay).toBe(REPORT_DELAY_MS);
        expect(options?.deduplication?.makeId(data)).toBe(`${ORG}:2026-10`);
        // A spend arriving while the report waits joins it without pushing it later.
        expect(options?.deduplication?.extend).toBe(false);
      }
    });

    /** @scenario "A spend report that cannot be dispatched is raised so the event is delivered again" */
    it("raises a refused dispatch", async () => {
      const refusal = new Error("the queue refused the send");
      const billing = rollUp({
        send: async () => {
          throw refusal;
        },
      });

      await expect(billing.receive(spendConfirmed())).rejects.toBe(refusal);
    });
  });

  describe("when gateway confirms spend no meter bills", () => {
    /** @scenario "Spend of any other request type dispatches nothing" */
    it("dispatches nothing for a chat completion", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed({ requestType: "chat_completion" }));
      await billing.receive(spendConfirmed({ requestType: "" }));

      expect(billing.sent).toEqual([]);
    });

    /** @scenario "A spend naming no organization dispatches nothing" */
    it("dispatches nothing for a spend with an empty organization", async () => {
      const billing = rollUp();

      await billing.receive(spendConfirmed({ organizationId: "" }));

      expect(billing.sent).toEqual([]);
    });

    /** @scenario "Spend no meter bills is skipped before it is queued" */
    it("skips such events before they are queued", () => {
      const { subscribers } = rollUp();
      const filter = subscribers.find(({ name }) => name === SPEND_LANE)?.options?.enqueue?.filter;

      expect(filter?.(spendConfirmed({ requestType: "chat_completion" }))).toBe(false);
      expect(filter?.(spendConfirmed({ organizationId: "" }))).toBe(false);
      expect(filter?.(spendConfirmed({ requestType: PII_REDACTION_REQUEST_TYPE }))).toBe(true);
    });
  });

  describe("when a report dispatched by spend runs", () => {
    /** @scenario "A spend report dispatches one follow-up for the same organization and month" */
    it("dispatches exactly one follow-up for the same month, after a longer delay", async () => {
      const billing = rollUp();

      await billing.run(spendReport());

      expect(billing.sent.map(({ data }) => data)).toEqual([
        expect.objectContaining({
          organizationId: ORG,
          billingMonth: "2026-10",
          trigger: "spend_follow_up",
        }),
      ]);
      expect(billing.sent[0]?.options?.delay).toBeGreaterThan(REPORT_DELAY_MS);
    });

    /** @scenario "A spend or convergence report never replaces the follow-up, and a later follow-up moves it later" */
    it("queues the follow-up under its own key, with a window that covers its delay", async () => {
      const billing = rollUp();

      await billing.run(spendReport());
      const [followUp] = billing.sent;
      const { trigger: _trigger, ...convergence } = spendReport();
      if (!followUp) throw new Error("the spend report dispatched no follow-up");

      expect(reportDedupId(followUp.data)).not.toBe(reportDedupId(spendReport()));
      expect(reportDedupId(followUp.data)).not.toBe(reportDedupId(convergence));
      expect(followUp.options?.deduplication?.makeId(followUp.data)).toBe(
        `${ORG}:2026-10:spend_follow_up`,
      );
      expect(followUp.options?.deduplication?.ttlMs).toBeGreaterThan(followUp.options?.delay ?? 0);

      await billing.run(spendReport());
      const laterFollowUp = billing.sent[1];
      if (!laterFollowUp) throw new Error("the later spend report dispatched no follow-up");
      expect(reportDedupId(laterFollowUp.data)).toBe(reportDedupId(followUp.data));
    });

    /** @scenario "The follow-up dispatches no further report" */
    it("dispatches nothing from a follow-up whose spend did not move", async () => {
      const billing = rollUp();

      await billing.run({ ...spendReport(), trigger: "spend_follow_up" });

      expect(billing.sent).toEqual([]);
    });

    /** @scenario "A spend row that lands within the follow-up's delay is still sent" */
    /** @scenario "Instant Eval spend confirmed after the month's last trace is reported" */
    it("sends an Instant Eval row that landed after the first report, from the follow-up", async () => {
      const ledger = { instantEval: 0, piiRedaction: 0 };
      const billing = rollUp({ ledger });
      await billing.receive(spendConfirmed({ requestType: INSTANT_EVAL_REQUEST_TYPE }));
      await billing.run(billing.sent[0]!.data);
      expect(billing.meterEvents).toEqual([]);

      ledger.instantEval = 12_345;
      const followUp = billing.sent.find(({ data }) => data.trigger === "spend_follow_up");
      await billing.run(followUp!.data);

      expect(billing.meterEvents.map(({ eventName }) => eventName)).toEqual([
        INSTANT_EVAL_USD_EVENT_NAME,
      ]);
      const after = billing.sent.slice(billing.sent.indexOf(followUp!) + 1);
      expect(after.map(({ data }) => data.trigger)).toEqual([undefined]);
    });

    /** @scenario "PII redaction spend confirmed after the month's last trace is reported" */
    it("sends a PII redaction row confirmed after the month's last trace", async () => {
      const ledger = { instantEval: 0, piiRedaction: 0 };
      const billing = rollUp({ ledger });
      await billing.receive(spendConfirmed({ requestType: PII_REDACTION_REQUEST_TYPE }));
      ledger.piiRedaction = 5_000;

      await billing.run(billing.sent[0]!.data);

      expect(billing.meterEvents.map(({ eventName }) => eventName)).toEqual([
        PII_REDACTION_USD_EVENT_NAME,
      ]);
    });

    /** @scenario "A spend report for an organization that is not usage billed dispatches no follow-up" */
    it("dispatches no follow-up for an organization on a free plan", async () => {
      const billing = rollUp({ lookup: async () => ({ outcome: "not_usage_billed" }) });

      await billing.run(spendReport());

      expect(billing.sent).toEqual([]);
    });

    /** @scenario "A spend report whose organization cannot be read is retried without a follow-up" */
    it("raises an unreadable organization and dispatches no follow-up", async () => {
      const unreadable = new Error("the organization could not be read");
      const billing = rollUp({
        lookup: async () => {
          throw unreadable;
        },
      });

      await expect(billing.run(spendReport())).rejects.toBe(unreadable);
      expect(billing.sent).toEqual([]);
    });
  });

  describe("when a report dispatched by month_counted runs", () => {
    /** @scenario "A report dispatched by month_counted dispatches no follow-up" */
    it("dispatches nothing when it has nothing new to send, as before", async () => {
      const billing = rollUp();

      await billing.run({
        organizationId: ORG,
        billingMonth: "2026-10",
        tenantId: ORG,
        occurredAt: MID_OCTOBER,
        billableEvents: 0,
        countedEventId: "evt_counted_1",
      });

      expect(billing.sent).toEqual([]);
    });
  });
});
