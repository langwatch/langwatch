/**
 * Instant Evals and PII redaction usage is billed only from the day its price line was added
 * (ADR-174 decision 26), over the real spend reads and a ledger dated row by row.
 * @see enterprise/modules/billing/specs/usage-billed-from-line-date.feature
 */
import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  BILLING_REPORT_COMMAND_TYPES,
  type StripePriceName,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import type { BillingSubscription } from "../../rules/billing-stripe-shapes.rules.ts";
import { INSTANT_EVAL_USD_EVENT_NAME } from "../../rules/instant-eval-meter.rules.ts";
import { PII_REDACTION_USD_EVENT_NAME } from "../../rules/pii-redaction-meter.rules.ts";
import { priceLineOf, type PriceLine } from "../../rules/price-line.rules.ts";
import { BillingErrorReporterService } from "../../services/billing-error-reporter.service.ts";
import { InstantEvalSpendQueryService } from "../../services/instant-eval-spend-query.service.ts";
import { PiiRedactionSpendQueryService } from "../../services/pii-redaction-spend-query.service.ts";
import type { UsageReportingService } from "../../services/usage-reporting.service.ts";
import { ReportUsageForMonthCommandHandler } from "../report-usage-for-month.commands.ts";

const ORG = "org_1";
const BILLING_MONTH = "2026-02";
const MONTH_START_MS = Date.UTC(2026, 1, 1);
const ON_THE_3RD_MS = Date.UTC(2026, 1, 3, 9);
const ON_THE_5TH_MS = Date.UTC(2026, 1, 5, 12);
const ON_THE_10TH_MS = Date.UTC(2026, 1, 10, 9);
const ON_THE_12TH_MS = Date.UTC(2026, 1, 12, 15);
const ON_THE_20TH_MS = Date.UTC(2026, 1, 20, 18);
/** One dollar of spend, in the nano-USD the ledger holds. */
const ONE_DOLLAR_NANO_USD = 1_000_000_000;

const NO_LINE: PriceLine = { carried: false };
const lineSince = (addedAtMs: number): PriceLine => ({ carried: true, addedAtMs });
/** The ids this mode maps for the two usage prices. */
const PRICE_IDS: Partial<Record<StripePriceName, string>> = {
  GROWTH_INSTANT_EVAL_USD: "price_instant_eval",
  GROWTH_PII_REDACTION_USD: "price_pii_redaction",
};

/** A subscription at Stripe with an Instant Evals line created at `lineAtMs`. */
function instantEvalSubscription({
  lineAtMs,
  endedAtMs,
}: {
  lineAtMs: number;
  endedAtMs?: number;
}): BillingSubscription {
  return {
    id: `sub_${lineAtMs}`,
    status: endedAtMs === undefined ? "active" : "canceled",
    canceledAt: endedAtMs === undefined ? null : endedAtMs / 1000,
    billingThreshold: null,
    items: [
      {
        id: `si_${lineAtMs}`,
        priceId: "price_instant_eval",
        unitAmount: null,
        interval: "month",
        quantity: null,
        createdAt: lineAtMs / 1000,
      },
    ],
    ...(endedAtMs === undefined ? {} : { endedAt: endedAtMs / 1000 }),
  };
}

type LedgerRow = { requestType: string; atMs: number; nanoUsd: number };

function lookup({
  contract = "cloud",
  seatStartMs = null,
}: {
  contract?: "cloud" | "connected";
  seatStartMs?: number | null;
} = {}): BillingReportOrganizationLookup {
  return {
    outcome: "usage_billed",
    organization: {
      id: ORG,
      stripeCustomerId: "cus_1",
      subscriptions: [{ id: "sub_1" }],
      contract,
      growthSeatPeriods: contract === "cloud" ? [{ startMs: seatStartMs, endMs: null }] : [],
    },
  };
}

/** The report composed over memory checkpoints, a dated ledger and the lines a test moves. */
function billing({
  organization = lookup(),
  ledger,
  lines,
  stripe,
}: {
  organization?: BillingReportOrganizationLookup;
  ledger: LedgerRow[];
  lines: Partial<Record<StripePriceName, PriceLine>>;
  /** The customer's subscriptions at Stripe; when given, the lines are read off them. */
  stripe?: readonly BillingSubscription[];
}) {
  const repositories = MemoryBillingRepositories.create();
  const meterEvents: { eventName: string; value: number }[] = [];
  const reads: { requestType: string; fromMs?: number; toMs?: number }[] = [];
  const peers = {
    isSpendSourceAvailable: () => true,
    listProjectIds: async () => ["project_1"],
    sumSpendNanoUsdByRequestType: async (input: {
      requestType: string;
      fromMs?: number;
      toMs?: number;
    }) => {
      reads.push({ requestType: input.requestType, fromMs: input.fromMs, toMs: input.toMs });
      return ledger
        .filter(
          (row) =>
            row.requestType === input.requestType &&
            row.atMs >= (input.fromMs ?? Number.NEGATIVE_INFINITY) &&
            row.atMs < (input.toMs ?? Number.POSITIVE_INFINITY),
        )
        .reduce((sum, row) => sum + row.nanoUsd, 0);
    },
  };
  const instantEval = InstantEvalSpendQueryService.create(peers);
  const piiRedaction = PiiRedactionSpendQueryService.create(peers);
  const handler = ReportUsageForMonthCommandHandler.create({
    organizations: { getOrganizationForBilling: async () => organization },
    billingCheckpoints: repositories.checkpoints,
    getUsageReportingService: () =>
      createApiFixture<UsageReportingService>({
        reportUsageDelta: async ({ events }) =>
          events.map((event) => {
            meterEvents.push({ eventName: event.eventName, value: event.value });
            return { identifier: event.identifier, reported: true, valueSent: event.value };
          }),
      }),
    queryInstantEvalSpendTotal: (input) => instantEval.queryInstantEvalSpendTotal(input),
    isInstantEvalMeterProvisioned: () => true,
    queryPiiRedactionSpendTotal: (input) => piiRedaction.queryPiiRedactionSpendTotal(input),
    isPiiRedactionMeterProvisioned: () => true,
    subscriptionCarriesPrice: async ({ price, billingMonth }) =>
      stripe === undefined
        ? (lines[price] ?? NO_LINE)
        : priceLineOf({
            subscriptions: stripe,
            prices: [{ priceName: price, priceId: PRICE_IDS[price] }],
            billingMonth,
          }),
    selfDispatch: async () => {},
    organizationCache: repositories.organizationCache,
    errorReporter: BillingErrorReporterService.create(),
    connectedUsageCeiling: async () => null,
  });

  return {
    meterEvents,
    reads,
    lines,
    checkpoints: repositories.checkpoints,
    sent: (eventName: string) =>
      meterEvents.filter((event) => event.eventName === eventName).map(({ value }) => value),
    readsOf: (requestType: string) => reads.filter((read) => read.requestType === requestType),
    report: () =>
      handler.handle({
        tenantId: createTenantId(ORG),
        aggregateId: ORG,
        type: BILLING_REPORT_COMMAND_TYPES.REPORT_USAGE_FOR_MONTH,
        data: { organizationId: ORG, billingMonth: BILLING_MONTH, tenantId: ORG, occurredAt: 0 },
      }),
  };
}

/** One dollar of each kind on the 5th and two on the 20th of February. */
const SPEND_ON_THE_5TH_AND_20TH: LedgerRow[] = [
  { requestType: INSTANT_EVAL_REQUEST_TYPE, atMs: ON_THE_5TH_MS, nanoUsd: ONE_DOLLAR_NANO_USD },
  {
    requestType: INSTANT_EVAL_REQUEST_TYPE,
    atMs: ON_THE_20TH_MS,
    nanoUsd: 2 * ONE_DOLLAR_NANO_USD,
  },
  { requestType: PII_REDACTION_REQUEST_TYPE, atMs: ON_THE_5TH_MS, nanoUsd: ONE_DOLLAR_NANO_USD },
  {
    requestType: PII_REDACTION_REQUEST_TYPE,
    atMs: ON_THE_20TH_MS,
    nanoUsd: 2 * ONE_DOLLAR_NANO_USD,
  },
];

describe("billing usage from the day its price line was added", () => {
  describe("given usage held for want of the Instant Evals line, which is added on the 12th", () => {
    /** @scenario "Usage before the price line was added is never billed" */
    it("bills only the spend since the line, never the 5th's", async () => {
      const report = billing({ ledger: SPEND_ON_THE_5TH_AND_20TH, lines: {} });

      await report.report();
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([]);

      report.lines.GROWTH_INSTANT_EVAL_USD = lineSince(ON_THE_12TH_MS);
      await report.report();
      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE).at(-1)?.fromMs).toBe(ON_THE_12TH_MS);
    });
  });

  describe("given usage held for want of the PII redaction line, which is added on the 12th", () => {
    /** @scenario "Usage before the price line was added is never billed" */
    it("bills only the PII redaction spend since the line, never the month from its first day", async () => {
      const report = billing({ ledger: SPEND_ON_THE_5TH_AND_20TH, lines: {} });

      await report.report();
      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);

      report.lines.GROWTH_PII_REDACTION_USD = lineSince(ON_THE_12TH_MS);
      await report.report();
      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE).at(-1)?.fromMs).toBe(ON_THE_12TH_MS);
    });
  });

  describe("given a subscription that has carried the Instant Evals line since before the month", () => {
    /** @scenario "Usage after the price line was added is billed" */
    it("bills the whole month's spend", async () => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_INSTANT_EVAL_USD: lineSince(Date.UTC(2026, 0, 15)) },
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([3]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(MONTH_START_MS);
    });
  });

  describe("given a subscription that gained the PII redaction line on the 10th", () => {
    /** @scenario "A PII redaction line added mid-month bills only from that moment" */
    it("bills only the PII redaction spend since the 10th", async () => {
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_PII_REDACTION_USD: lineSince(ON_THE_10TH_MS) },
      });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(PII_REDACTION_REQUEST_TYPE)[0]?.fromMs).toBe(ON_THE_10TH_MS);
    });
  });

  describe("given a growth-seat subscription from the 3rd whose Instant Evals line came on the 10th", () => {
    /** @scenario "The month starts at the later of the subscription's start and the line's" */
    it("reads the spend from the 10th", async () => {
      const report = billing({
        organization: lookup({ seatStartMs: ON_THE_3RD_MS }),
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: { GROWTH_INSTANT_EVAL_USD: lineSince(ON_THE_10TH_MS) },
      });

      await report.report();

      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(ON_THE_10TH_MS);
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
    });
  });

  describe("given a PII redaction checkpoint at 1.5000 dollars and a line from the 10th", () => {
    /** @scenario "A month already reported is not lowered when the line's start narrows it" */
    it("sends nothing and keeps the checkpoint, then bills spend past it", async () => {
      const ledger: LedgerRow[] = [
        { requestType: PII_REDACTION_REQUEST_TYPE, atMs: ON_THE_12TH_MS, nanoUsd: 500_000_000 },
      ];
      const report = billing({
        ledger,
        lines: { GROWTH_PII_REDACTION_USD: lineSince(ON_THE_10TH_MS) },
      });
      const at = {
        organizationId: ORG,
        billingMonth: BILLING_MONTH,
        meter: PII_REDACTION_USD_EVENT_NAME,
      };
      await report.checkpoints.confirm({ ...at, lastReportedTotal: 15_000 });

      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([]);
      expect(await report.checkpoints.findCheckpoint(at)).toMatchObject({
        lastReportedTotal: 15_000,
      });

      ledger.push({
        requestType: PII_REDACTION_REQUEST_TYPE,
        atMs: ON_THE_20TH_MS,
        nanoUsd: 1_500_000_000,
      });
      await report.report();

      expect(report.sent(PII_REDACTION_USD_EVENT_NAME)).toEqual([0.5]);
    });
  });

  describe("given an Instant Evals line that ended on the 6th and a new one on another subscription from the 15th", () => {
    /** @scenario "Usage while no line existed anywhere is never billed" */
    it("never bills the 10th's spend, when no line existed anywhere", async () => {
      const report = billing({
        ledger: [
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: Date.UTC(2026, 1, 3, 9),
            nanoUsd: ONE_DOLLAR_NANO_USD,
          },
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: ON_THE_10TH_MS,
            nanoUsd: 4 * ONE_DOLLAR_NANO_USD,
          },
          {
            requestType: INSTANT_EVAL_REQUEST_TYPE,
            atMs: ON_THE_20TH_MS,
            nanoUsd: 2 * ONE_DOLLAR_NANO_USD,
          },
        ],
        lines: {},
        stripe: [
          instantEvalSubscription({
            lineAtMs: Date.UTC(2026, 0, 15),
            endedAtMs: Date.UTC(2026, 1, 6, 10),
          }),
          instantEvalSubscription({ lineAtMs: Date.UTC(2026, 1, 15, 12) }),
        ],
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([2]);
      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(Date.UTC(2026, 1, 15, 12));
    });
  });

  describe("given an Instant Evals line Stripe answered with no creation time", () => {
    /** @scenario "A line with no recorded creation is refused as a failed read" */
    it("sends nothing and counts a failed read toward the breaker", async () => {
      const live = instantEvalSubscription({ lineAtMs: ON_THE_12TH_MS });
      const unknownCreation: BillingSubscription = {
        ...live,
        items: live.items.map((item) => ({ ...item, createdAt: Number.NaN })),
      };
      const report = billing({
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: {},
        stripe: [unknownCreation],
      });

      await report.report();

      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([]);
      expect(
        await report.checkpoints.findCheckpoint({
          organizationId: ORG,
          billingMonth: BILLING_MONTH,
          meter: INSTANT_EVAL_USD_EVENT_NAME,
        }),
      ).toMatchObject({ lastReportedTotal: 0, pendingReportedTotal: null, consecutiveFailures: 1 });
    });
  });

  describe("given a connected account", () => {
    /** @scenario "A connected customer's hosted usage keeps the whole month" */
    it("reads its Instant Evals spend from the month's start", async () => {
      const report = billing({
        organization: lookup({ contract: "connected" }),
        ledger: SPEND_ON_THE_5TH_AND_20TH,
        lines: {},
      });

      await report.report();

      expect(report.readsOf(INSTANT_EVAL_REQUEST_TYPE)[0]?.fromMs).toBe(MONTH_START_MS);
      expect(report.sent(INSTANT_EVAL_USD_EVENT_NAME)).toEqual([3]);
    });
  });
});
