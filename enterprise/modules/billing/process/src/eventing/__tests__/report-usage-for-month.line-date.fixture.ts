/**
 * The monthly report composed over memory checkpoints, the real spend reads, a ledger dated row
 * by row and the price lines a test moves, for the line-date scenarios (ADR-174 decision 26).
 */
import { PII_REDACTION_REQUEST_TYPE } from "@langwatch/data-privacy-contract/pii-redaction-spend";
import {
  BILLING_REPORT_COMMAND_TYPES,
  type StripePriceName,
} from "@langwatch/enterprise-billing-contract";
import { createTenantId } from "@langwatch/eventing";
import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-judge-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import type { BillingReportOrganizationLookup } from "../../repositories/billing-report-organization.repository.ts";
import { MemoryBillingRepositories } from "../../repositories/memory/memory.billing.repositories.ts";
import type { BillingSubscription } from "../../rules/billing-stripe-shapes.rules.ts";
import { priceLineOf, type PriceLine } from "../../rules/price-line.rules.ts";
import { BillingErrorReporterService } from "../../services/billing-error-reporter.service.ts";
import { InstantEvalSpendQueryService } from "../../services/instant-eval-spend-query.service.ts";
import { PiiRedactionSpendQueryService } from "../../services/pii-redaction-spend-query.service.ts";
import type { UsageReportingService } from "../../services/usage-reporting.service.ts";
import { ReportUsageForMonthCommandHandler } from "../report-usage-for-month.commands.ts";

export const ORG = "org_1";
export const BILLING_MONTH = "2026-02";
export const MONTH_START_MS = Date.UTC(2026, 1, 1);
export const ON_THE_3RD_MS = Date.UTC(2026, 1, 3, 9);
export const ON_THE_5TH_MS = Date.UTC(2026, 1, 5, 12);
export const ON_THE_10TH_MS = Date.UTC(2026, 1, 10, 9);
export const ON_THE_12TH_MS = Date.UTC(2026, 1, 12, 15);
export const ON_THE_20TH_MS = Date.UTC(2026, 1, 20, 18);
/** One dollar of spend, in the nano-USD the ledger holds. */
export const ONE_DOLLAR_NANO_USD = 1_000_000_000;

const NO_LINE: PriceLine = { carried: false };
export const lineSince = (addedAtMs: number): PriceLine => ({ carried: true, addedAtMs });
/** The ids this mode maps for the two usage prices. */
const PRICE_IDS: Partial<Record<StripePriceName, string>> = {
  GROWTH_INSTANT_EVAL_USD: "price_instant_eval",
  GROWTH_PII_REDACTION_USD: "price_pii_redaction",
};

/** A subscription at Stripe with an Instant Evals line created at `lineAtMs`. */
export function instantEvalSubscription({
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

export type LedgerRow = { requestType: string; atMs: number; nanoUsd: number };

export function lookup({
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
export function billing({
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
    subscriptionPriceLine: async ({ prices, billingMonth }) =>
      stripe === undefined
        ? (prices.map((price) => lines[price]).find((line) => line !== undefined) ?? NO_LINE)
        : priceLineOf({
            subscriptions: stripe,
            prices: prices.map((priceName) => ({ priceName, priceId: PRICE_IDS[priceName] })),
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
export const SPEND_ON_THE_5TH_AND_20TH: LedgerRow[] = [
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
