/**
 * The billing ops functions' test world: ACME's billing facts, billing stand-ins for a Cloud and
 * a self-hosted deployment, and a caller redeemed through the shared staff access world.
 * @see modules/staff-access/specs/staff-access-functions-billing.feature
 */
import {
  BillingFactsUnavailableError,
  type BillingApi,
  type OrganizationBillingFacts,
} from "@langwatch/enterprise-billing-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";

import { MemoryStaffAccessRepositories } from "../../../repositories/memory/memory.staff-access.repositories.ts";
import { redeemedSession, type requestBody, staffAccessWorld } from "./staff-access-world.ts";

export const ACME = "org_acme";
export const NOW = Temporal.Instant.from("2026-11-20T10:00:00Z");
export const ms = (iso: string) => Date.parse(iso);

export const ACME_FACTS: OrganizationBillingFacts = {
  organizationId: ACME,
  pricingModel: "seat_event",
  current: {
    subscriptionId: "sub_new",
    plan: "GROWTH_SEAT_EUR_MONTHLY",
    state: "active",
    createdAt: ms("2026-11-01T00:00:00Z"),
    startedAt: ms("2026-11-01T00:05:00Z"),
    endedAt: null,
    lastPaymentFailedAt: ms("2026-11-18T00:00:00Z"),
    linkedToStripe: true,
    fullSeats: 5,
    liteSeats: null,
    developerSeats: 2,
    eventsCap: null,
    retentionDays: 90,
    seatsKept: null,
    seatsKeptUntil: null,
    paymentRecoveryStartedAt: ms("2026-11-18T00:00:00Z"),
    paymentRecoveryNoticeDay: 1,
  },
  subscriptionsByState: [
    { state: "active", count: 1 },
    { state: "cancelled", count: 1 },
  ],
  lastCancelledAt: ms("2026-10-31T23:00:00Z"),
  overPlanSince: null,
};

export function cloudBilling(asked: { organizations: string[]; ranges: [number, number][] }) {
  return createApiFixture<BillingApi>({
    getOrganizationBillingFacts: async ({ organizationId }) => {
      asked.organizations.push(organizationId);
      return organizationId === ACME
        ? ACME_FACTS
        : {
            ...ACME_FACTS,
            organizationId,
            current: null,
            subscriptionsByState: [],
            lastCancelledAt: null,
          };
    },
    findSubscriptionCounts: async ({ since, until }) => {
      asked.ranges.push([since, until]);
      return [
        {
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          state: "pending",
          subscriptions: 2,
          activated: 0,
          organizations: 2,
        },
        {
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          state: "active",
          subscriptions: 1,
          activated: 1,
          organizations: 1,
        },
      ];
    },
    findStripePriceFacts: async () => [
      {
        priceId: "price_seat",
        catalogueName: "GROWTH_SEAT_EUR_MONTHLY",
        currency: "eur",
        unitAmount: 2900,
        interval: "month",
        intervalCount: 1,
        taxBehavior: "exclusive",
        active: true,
        livemode: true,
      },
      {
        priceId: "price_old",
        catalogueName: "other",
        currency: "usd",
        unitAmount: 1000,
        interval: null,
        intervalCount: null,
        taxBehavior: null,
        active: false,
        livemode: true,
      },
    ],
  });
}

export function selfHostedBilling() {
  const refuse = async (): Promise<never> => {
    throw new BillingFactsUnavailableError({ reason: "not_cloud" });
  };
  return createApiFixture<BillingApi>({
    getOrganizationBillingFacts: refuse,
    findSubscriptionCounts: refuse,
    findStripePriceFacts: refuse,
  });
}

/** A session for `functions`, requested, approved and redeemed at `NOW` over `billing`. */
export async function caller({
  billing,
  scopes,
  functions,
  organization,
}: {
  billing: BillingApi;
  scopes: Parameters<typeof requestBody>[0]["scopes"];
  functions: string[];
  /** The organization's slug; ACME's by default. */
  organization?: string;
}) {
  const world = staffAccessWorld({ repositories: MemoryStaffAccessRepositories.create(), billing });
  world.state.at = NOW;
  const session = await redeemedSession({
    world,
    scopes,
    functions,
    ...(organization === undefined ? {} : { organization }),
  });
  return {
    repositories: world.repositories,
    session,
    call: (name: string, input: unknown = {}) => world.app.callFunction({ session, name, input }),
  };
}
