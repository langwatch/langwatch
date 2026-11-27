/**
 * The billing ops functions' test world: ACME's billing facts, billing stand-ins for a Cloud and
 * a self-hosted deployment, and a caller holding an approved session.
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

import { MemoryStaffAccessRepositories } from "../../../repositories/memory/memory.staff-access.repositories.ts";
import type { StaffAccessRequestRow } from "../../../repositories/staff-access.repository.ts";
import { StaffAccessActivityFunctionReadsService } from "../../../services/staff-access-activity-function-reads.service.ts";
import { StaffAccessBillingFunctionReadsService } from "../../../services/staff-access-billing-function-reads.service.ts";
import { StaffAccessFunctionReadsService } from "../../../services/staff-access-function-reads.service.ts";
import { StaffAccessFunctionService } from "../../../services/staff-access-function.service.ts";
import { StaffAccessLangyFunctionReadsService } from "../../../services/staff-access-langy-function-reads.service.ts";
import { StaffAccessPeopleFunctionReadsService } from "../../../services/staff-access-people-function-reads.service.ts";
import { StaffAccessPlatformFunctionReadsService } from "../../../services/staff-access-platform-function-reads.service.ts";
import { StaffAccessTelemetryFunctionReadsService } from "../../../services/staff-access-telemetry-function-reads.service.ts";

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

export type BillingReads = Pick<
  BillingApi,
  "getOrganizationBillingFacts" | "findSubscriptionCounts" | "findStripePriceFacts"
>;

export function cloudBilling(asked: { organizations: string[]; ranges: [number, number][] }) {
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

export function selfHostedBilling() {
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

export async function caller({
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
      telemetry: StaffAccessTelemetryFunctionReadsService.create({ ops: createApiFixture() }),
      langy: StaffAccessLangyFunctionReadsService.create({
        langy: createApiFixture(),
        projects: createApiFixture(),
      }),
      people: StaffAccessPeopleFunctionReadsService.create({
        organizations: createApiFixture(),
        users: createApiFixture(),
        entitlements: createApiFixture(),
      }),
      activity: StaffAccessActivityFunctionReadsService.create({
        organizations: createApiFixture(),
        projects: createApiFixture(),
        codingAgents: createApiFixture(),
        gateway: createApiFixture(),
        instantEvals: createApiFixture(),
        traces: createApiFixture(),
        evaluations: createApiFixture(),
        scenarios: createApiFixture(),
        auth: createApiFixture(),
        entitlements: createApiFixture(),
      }),
      platform: StaffAccessPlatformFunctionReadsService.create({
        ops: createApiFixture(),
        langy: createApiFixture(),
        projects: createApiFixture(),
        dataRetention: createApiFixture(),
        traces: createApiFixture(),
        evaluations: createApiFixture(),
      }),
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

export { codeOf } from "./staff-access-world.ts";
