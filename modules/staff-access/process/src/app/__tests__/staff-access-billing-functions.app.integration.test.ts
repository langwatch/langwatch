/**
 * The billing ops functions through the function service: an approved session's call, its
 * schema checks and trail row, over billing's API as a stand-in.
 * @see modules/staff-access/specs/staff-access-functions-billing.feature
 */
import {
  BillingFactsUnavailableError,
  type BillingApi,
  type OrganizationBillingFacts,
} from "@langwatch/enterprise-billing-contract";
import type { StaffAccessDoorSession } from "@langwatch/staff-access-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryStaffAccessRepositories } from "../../repositories/memory/memory.staff-access.repositories.ts";
import type { StaffAccessRequestRow } from "../../repositories/staff-access.repository.ts";
import { StaffAccessBillingFunctionReadsService } from "../../services/staff-access-billing-function-reads.service.ts";
import { StaffAccessFunctionReadsService } from "../../services/staff-access-function-reads.service.ts";
import { StaffAccessFunctionService } from "../../services/staff-access-function.service.ts";

const ACME = "org_acme";
const NOW = Temporal.Instant.from("2026-11-20T10:00:00Z");
const ms = (iso: string) => Date.parse(iso);

const ACME_FACTS: OrganizationBillingFacts = {
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

type BillingReads = Pick<
  BillingApi,
  "getOrganizationBillingFacts" | "findSubscriptionCounts" | "findStripePriceFacts"
>;

function cloudBilling(asked: { organizations: string[]; ranges: [number, number][] }) {
  return createApiFixture<BillingReads>({
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

function selfHostedBilling() {
  const refuse = async (): Promise<never> => {
    throw new BillingFactsUnavailableError({ reason: "not_cloud" });
  };
  return createApiFixture<BillingReads>({
    getOrganizationBillingFacts: refuse,
    findSubscriptionCounts: refuse,
    findStripePriceFacts: refuse,
  });
}

function requestRow(overrides: Partial<StaffAccessRequestRow>): StaffAccessRequestRow {
  return {
    id: "request_1",
    requesterId: "requester_1",
    ownerUserId: "user_olivia",
    scopes: ["org:metadata"],
    functions: [],
    organizationId: ACME,
    organizationName: "ACME",
    reason: "check ACME's failed payment",
    codeChallenge: "c",
    machine: "olivia-macbook",
    requestIp: null,
    status: "approved",
    expiresAt: NOW.add({ hours: 1 }),
    approvedAt: NOW,
    spendApproved: false,
    approvalCredentialId: null,
    approvalSignature: null,
    signedHash: null,
    redeemedAt: NOW,
    pinnedIp: null,
    apiKeyId: null,
    hashedOpsToken: null,
    opsTokenLookupId: null,
    accessExpiresAt: NOW.add({ hours: 1 }),
    revokedAt: null,
    revokedByUserId: null,
    revokeCause: null,
    endAuditedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

const absent = { reads: {} } as never;

async function caller({
  billing,
  scopes,
  functions,
  organizationId = ACME,
}: {
  billing: BillingReads;
  scopes: StaffAccessRequestRow["scopes"];
  functions: string[];
  organizationId?: string | null;
}) {
  const repositories = MemoryStaffAccessRepositories.create();
  await repositories.requests.create(requestRow({ scopes, functions, organizationId }));
  const service = StaffAccessFunctionService.create({
    requests: repositories.requests,
    events: repositories.events,
    reads: StaffAccessFunctionReadsService.create({
      organizations: createApiFixture(),
      projects: createApiFixture(),
      featureFlags: createApiFixture(),
      entitlements: createApiFixture(),
      traces: createApiFixture(),
      evaluations: createApiFixture(),
      monitors: createApiFixture(),
      apiKeys: createApiFixture(),
      ops: createApiFixture(),
      auth: createApiFixture(),
      telemetry: absent,
      langy: absent,
      people: absent,
      activity: absent,
      platform: absent,
      billing: StaffAccessBillingFunctionReadsService.create({ billing }),
    } as Parameters<typeof StaffAccessFunctionReadsService.create>[0]),
    now: () => NOW,
  });
  const session = {
    kind: "ops",
    requestId: "request_1",
    scopes,
    ipAddress: "203.0.113.7",
    userAgent: "langwatch-cli",
  } as StaffAccessDoorSession;
  return {
    repositories,
    call: (name: string, input: unknown = {}) => service.callFunction({ session, name, input }),
  };
}

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe("the billing ops functions", () => {
  describe("given a metadata session on ACME approved for org.billing", () => {
    /** @scenario "org.billing answers the organization's subscription state" */
    /** @scenario "org.billing reads only the approved organization" */
    it("answers ACME's subscription facts and asks billing for ACME only", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
      });

      const answered = await call("org.billing");

      expect(asked.organizations).toEqual([ACME]);
      expect(answered).toEqual({
        name: "org.billing",
        rows: 1,
        output: {
          organizationId: ACME,
          pricingModel: "seat_event",
          subscriptionId: "sub_new",
          plan: "GROWTH_SEAT_EUR_MONTHLY",
          state: "active",
          createdAt: "2026-11-01T00:00:00.000Z",
          startedAt: "2026-11-01T00:05:00.000Z",
          endedAt: null,
          lastPaymentFailedAt: "2026-11-18T00:00:00.000Z",
          pastDue: true,
          paymentRecoveryStartedAt: "2026-11-18T00:00:00.000Z",
          paymentRecoveryNoticeDay: 1,
          linkedToStripe: true,
          fullSeats: 5,
          liteSeats: null,
          developerSeats: 2,
          eventsCap: null,
          retentionDays: 90,
          seatsKept: null,
          seatsKeptUntil: null,
          subscriptionsByState: { active: 1, cancelled: 1 },
          lastCancelledAt: "2026-10-31T23:00:00.000Z",
          overPlanSince: null,
        },
      });
      await expect(codeOf(call("org.billing", { organizationId: "org_globex" }))).resolves.toBe(
        "staff_function_bad_input",
      );
    });

    /** @scenario "org.billing answers an organization that never subscribed" */
    it("answers state none for an organization that never subscribed", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
        organizationId: "org_initech",
      });

      const { output } = await call("org.billing");

      expect(output).toMatchObject({
        organizationId: "org_initech",
        subscriptionId: null,
        plan: "none",
        state: "none",
        pastDue: false,
        subscriptionsByState: {},
      });
    });
  });

  describe("given an ops:read session", () => {
    /** @scenario "billing.subscriptions counts subscriptions created in a range by plan and state" */
    it("pages subscription counts over the range it asked billing for", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.subscriptions"],
        organizationId: null,
      });

      const { output } = await call("billing.subscriptions", { since: "2026-11-01T00:00:00Z" });

      expect(asked.ranges).toEqual([[ms("2026-11-01T00:00:00Z"), NOW.epochMilliseconds]]);
      expect(output).toEqual({
        items: [
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "active",
            subscriptions: 1,
            activated: 1,
            organizations: 1,
          },
          {
            plan: "GROWTH_SEAT_EUR_MONTHLY",
            state: "pending",
            subscriptions: 2,
            activated: 0,
            organizations: 2,
          },
        ],
        total: 2,
        truncated: false,
        nextCursor: null,
      });
    });

    /** @scenario "billing.subscriptions takes at most 31 days" */
    it("refuses a range over 31 days before asking billing", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.subscriptions"],
        organizationId: null,
      });

      await expect(
        codeOf(call("billing.subscriptions", { since: "2026-10-10T00:00:00Z" })),
      ).resolves.toBe("staff_function_bad_input");
      expect(asked.ranges).toEqual([]);
    });

    /** @scenario "billing.stripe_prices answers the catalogue with its tax behaviour" */
    it("pages the price catalogue by price id with its tax behaviour", async () => {
      const asked = { organizations: [] as string[], ranges: [] as [number, number][] };
      const { call } = await caller({
        billing: cloudBilling(asked),
        scopes: ["ops:read"],
        functions: ["billing.stripe_prices"],
        organizationId: null,
      });

      const first = await call("billing.stripe_prices", { limit: 1 });
      const firstPage = first.output as { items: { priceId: string }[]; nextCursor: string };
      const second = await call("billing.stripe_prices", {
        limit: 1,
        cursor: firstPage.nextCursor,
      });

      expect(first.output).toMatchObject({
        items: [{ priceId: "price_old", catalogueName: "other", taxBehavior: null, active: false }],
        total: 2,
        truncated: true,
      });
      expect(second.output).toMatchObject({
        items: [{ priceId: "price_seat", taxBehavior: "exclusive", currency: "eur" }],
        truncated: false,
        nextCursor: null,
      });
    });
  });

  describe("given a deployment that is not LangWatch Cloud", () => {
    /** @scenario "A billing function refuses by name off LangWatch Cloud" */
    it("refuses each billing function by name and trails the code", async () => {
      const platform = await caller({
        billing: selfHostedBilling(),
        scopes: ["ops:read"],
        functions: ["billing.stripe_prices", "billing.subscriptions"],
        organizationId: null,
      });
      const org = await caller({
        billing: selfHostedBilling(),
        scopes: ["org:metadata"],
        functions: ["org.billing"],
      });

      await expect(codeOf(org.call("org.billing"))).resolves.toBe("billing_facts_unavailable");
      await expect(
        codeOf(platform.call("billing.subscriptions", { since: "2026-11-01T00:00:00Z" })),
      ).resolves.toBe("billing_facts_unavailable");
      await expect(codeOf(platform.call("billing.stripe_prices"))).resolves.toBe(
        "billing_facts_unavailable",
      );
      const trail = await org.repositories.events.findByRequest({ requestId: "request_1" });
      expect(trail).toEqual([
        expect.objectContaining({
          functionName: "org.billing",
          status: 403,
          errorCode: "billing_facts_unavailable",
        }),
      ]);
    });
  });
});
