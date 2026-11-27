import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type {
  STAFF_ACCESS_BILLING_FUNCTIONS,
  StaffAccessFunctionInput,
  StaffAccessFunctionOutput,
} from "@langwatch/staff-access-contract";
import type { Instant } from "@langwatch/time";

import { pageOf, rangeOf, isoOfMs, pageInputOf } from "../rules/staff-access-function.rules.ts";
import type { StaffAccessFunctionRuns } from "./staff-access-function-reads.service.ts";

type BillingReadsDeps = Readonly<{
  billing: Pick<
    BillingApi,
    "getOrganizationBillingFacts" | "findSubscriptionCounts" | "findStripePriceFacts"
  >;
}>;

/**
 * The billing ops functions' reads, each through `BillingApi` (§3). Billing refuses off LangWatch
 * Cloud with `billing_facts_unavailable`, which reaches the caller as it is.
 */
export class StaffAccessBillingFunctionReadsService {
  readonly reads: StaffAccessFunctionRuns<keyof typeof STAFF_ACCESS_BILLING_FUNCTIONS>;

  private constructor(private readonly deps: BillingReadsDeps) {
    this.reads = {
      "org.billing": (call) => this.organizationBilling(call),
      "billing.subscriptions": (call) => this.subscriptions(call),
      "billing.stripe_prices": (call) => this.stripePrices(call),
    };
  }

  static create(deps: BillingReadsDeps): StaffAccessBillingFunctionReadsService {
    return new StaffAccessBillingFunctionReadsService(deps);
  }

  private async organizationBilling({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<StaffAccessFunctionOutput<"org.billing">> {
    const facts = await this.deps.billing.getOrganizationBillingFacts({ organizationId });
    const { current } = facts;
    return {
      organizationId: facts.organizationId,
      pricingModel: facts.pricingModel,
      subscriptionId: current?.subscriptionId ?? null,
      plan: current?.plan ?? "none",
      state: current?.state ?? "none",
      createdAt: typeof current?.createdAt === "number" ? isoOfMs(current?.createdAt) : null,
      startedAt: typeof current?.startedAt === "number" ? isoOfMs(current?.startedAt) : null,
      endedAt: typeof current?.endedAt === "number" ? isoOfMs(current?.endedAt) : null,
      lastPaymentFailedAt:
        typeof current?.lastPaymentFailedAt === "number"
          ? isoOfMs(current?.lastPaymentFailedAt)
          : null,
      pastDue:
        current !== null &&
        (current.state === "failed" || current.paymentRecoveryStartedAt !== null),
      paymentRecoveryStartedAt:
        typeof current?.paymentRecoveryStartedAt === "number"
          ? isoOfMs(current?.paymentRecoveryStartedAt)
          : null,
      paymentRecoveryNoticeDay: current?.paymentRecoveryNoticeDay ?? null,
      linkedToStripe: current?.linkedToStripe ?? false,
      fullSeats: current?.fullSeats ?? null,
      liteSeats: current?.liteSeats ?? null,
      developerSeats: current?.developerSeats ?? null,
      eventsCap: current?.eventsCap ?? null,
      retentionDays: current?.retentionDays ?? null,
      seatsKept: current?.seatsKept ?? null,
      seatsKeptUntil:
        typeof current?.seatsKeptUntil === "number" ? isoOfMs(current?.seatsKeptUntil) : null,
      subscriptionsByState: Object.fromEntries(
        facts.subscriptionsByState.map(({ state, count }) => [state, count]),
      ),
      lastCancelledAt:
        typeof facts.lastCancelledAt === "number" ? isoOfMs(facts.lastCancelledAt) : null,
      overPlanSince: typeof facts.overPlanSince === "number" ? isoOfMs(facts.overPlanSince) : null,
    };
  }

  private async subscriptions({
    input,
    at,
  }: {
    input: StaffAccessFunctionInput<"billing.subscriptions">;
    at: Instant;
  }): Promise<StaffAccessFunctionOutput<"billing.subscriptions">> {
    const range = rangeOf({
      since: input.since,
      ...(input.until ? { until: input.until } : {}),
      at,
    });
    const counts = await this.deps.billing.findSubscriptionCounts({
      since: range.since.epochMilliseconds,
      until: range.until.epochMilliseconds,
    });
    return pageOf({
      rows: counts.map((count) => ({ ...count })),
      keyOf: (row) => `${row.plan}/${row.state}`,
      name: "billing.subscriptions",
      ...pageInputOf(input),
    });
  }

  private async stripePrices({
    input,
  }: {
    input: StaffAccessFunctionInput<"billing.stripe_prices">;
  }): Promise<StaffAccessFunctionOutput<"billing.stripe_prices">> {
    const prices = await this.deps.billing.findStripePriceFacts();
    return pageOf({
      rows: prices.map((price) => ({ ...price })),
      keyOf: (row) => row.priceId,
      name: "billing.stripe_prices",
      ...pageInputOf(input),
    });
  }
}
