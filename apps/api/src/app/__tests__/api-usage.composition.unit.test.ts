import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { BillingSubscriptionRepository } from "@langwatch/enterprise-billing-server";
import { describe, expect, it } from "vitest";
import {
  ApiEntitlementAbsenceReport,
  composeApiPlanProvider,
  composeApiUsageStats,
} from "../api-usage.composition";

/**
 * What this file pins is this root's WIRING, not the plan policy.
 *
 * Which baseline a deployment starts from and which paid source is consulted
 * over it are `deploymentPlanSources`'s
 * (`@langwatch/enterprise-billing-server`), asserted where they are written, by
 * `deployment-plan-sources.unit.test.ts`. Both processes read that one
 * function; what remains different here is what this root names when a source
 * is missing, and the resolutions below are what prove it actually reached the
 * policy rather than composing a provider of its own.
 */

/**
 * The row shape, taken off the one read the source makes rather than imported:
 * `BillingSubscriptionRecord` is the billing package's own and is not on its
 * public surface, and restating twelve fields here is how a fixture starts
 * disagreeing with the table it stands for.
 */
type BillingSubscriptionRecord = NonNullable<
  Awaited<ReturnType<BillingSubscriptionRepository["tryFindActive"]>>
>;

/** Records which plan sources the composition said it did not hold. */
class RecordingEntitlementAbsence extends ApiEntitlementAbsenceReport {
  readonly sources: string[] = [];

  absent(source: "licence" | "subscription" | "usage-mail"): void {
    this.sources.push(source);
  }
}

const subscription = (
  overrides: Partial<BillingSubscriptionRecord> = {},
): BillingSubscriptionRecord => ({
  id: "sub-1",
  organizationId: "org-1",
  status: "ACTIVE",
  plan: PlanTypes.LAUNCH,
  stripeSubscriptionId: "stripe-1",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  startDate: new Date("2026-09-01T00:00:00.000Z"),
  endDate: null,
  maxMembers: null,
  maxMembersLite: null,
  maxMessagesPerMonth: null,
  lastPaymentFailedDate: null,
  ...overrides,
});

/** The one read the subscription source makes; nothing else is exercised. */
function subscriptions(active: BillingSubscriptionRecord | null): BillingSubscriptionRepository {
  return {
    tryFindActive: async () => active,
  } as unknown as BillingSubscriptionRepository;
}

describe("composeApiPlanProvider", () => {
  describe("given a hosted deployment holding the subscription rows", () => {
    it("resolves a paying organization onto its subscription's plan rather than the free baseline", async () => {
      const report = new RecordingEntitlementAbsence();

      const plans = composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
        report,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.free).toBe(false);
      expect(plan.type).toBe(PlanTypes.LAUNCH);
    });

    it("names no absent subscription source, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(subscription()),
        report,
      });

      expect(report.sources).toEqual(["licence"]);
    });

    it("still resolves the free baseline for an organization holding no subscription", async () => {
      const plans = composeApiPlanProvider({
        isSaas: true,
        subscriptions: subscriptions(null),
      });

      await expect(plans.getActivePlan({ organizationId: "org-1" })).resolves.toMatchObject({
        free: true,
      });
    });
  });

  describe("given a hosted deployment holding no subscription rows", () => {
    it("names the absence, so a paying organization reading as free is visible at boot", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({ isSaas: true, report });

      expect(report.sources).toEqual(["licence", "subscription"]);
    });
  });

  describe("given a self-hosted deployment", () => {
    it("names no absent subscription, because a self-hosted plan never comes from one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({ isSaas: false, report });

      expect(report.sources).toEqual(["licence"]);
    });
  });
});

/**
 * The reading, taken through the REAL composed stack.
 *
 * `composeApiUsageStats` builds `UsageStatsService` over the packaged
 * membership repository, the packaged `BillableEventsQueryService` and the plan
 * provider above; nothing below the ports is a stub. What the two suites pin is
 * which ClickHouse accessor each metering unit lands on, because that is the
 * wiring the process gets wrong: the events rollup is keyed by ORGANIZATION and
 * the trace rollup by PROJECT, and a tenant-keyed resolver handed an
 * organization id raises `UnknownTenantError` rather than answering.
 */
type FakeClickHouseClient = {
  query: (params: { query: string }) => Promise<{ json(): Promise<unknown> }>;
};

/** Answers one `total` row, and records the query it was asked. */
function countingClient(total: number, asked: string[]): FakeClickHouseClient {
  return {
    query: async ({ query }) => {
      asked.push(query);
      return { json: async () => [{ total: String(total) }] };
    },
  };
}

/** The rows the composed membership repository and the counter actually read. */
function usagePrisma(pricingModel: string | null) {
  return {
    organization: { findUnique: async () => ({ pricingModel }) },
    organizationUser: { findMany: async () => [] },
    organizationInvite: { findMany: async () => [] },
    customRole: { findMany: async () => [] },
    team: { findMany: async () => [] },
    roleBinding: { findMany: async () => [] },
    project: { findMany: async () => [{ id: "project-1" }] },
    cost: { aggregate: async () => ({ _sum: { amount: 0 } }) },
  } as unknown as Parameters<typeof composeApiUsageStats>[0]["prisma"];
}

const CALLER = { id: "user-1", email: "member@acme.test" } as never;

describe("composeApiUsageStats", () => {
  describe("given an organization metered in events", () => {
    /** @scenario "The month's events are read off the organization-keyed rollup" */
    it("counts it on the organization-keyed endpoint rather than reading unknown", async () => {
      const organizationsAsked: string[] = [];
      const tenantsAsked: string[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma(null),
        // Free tier, which is the branch that meters in EVENTS.
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async (tenantId) => {
            tenantsAsked.push(tenantId);
            return countingClient(0, []) as never;
          },
          resolveOrganizationClient: async (organizationId) => {
            organizationsAsked.push(organizationId);
            return countingClient(4210, []) as never;
          },
        },
        processName: "langwatch-api-test",
      });

      const stats = await usage
        .ports()
        .getUsageStats(undefined as never, { organizationId: "org-1", user: CALLER });

      expect(stats.usageUnit).toBe("events");
      // The number, not `null`: null is what an unread rollup renders as, and
      // this composition used to answer it for every events-metered org.
      expect(stats.currentMonthMessagesCount).toBe(4210);
    });

    /** @scenario "The organization id never reaches the tenant resolver" */
    it("hands the organization id to the organization accessor and never to the tenant one", async () => {
      const organizationsAsked: string[] = [];
      const tenantsAsked: string[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma(null),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async (tenantId) => {
            tenantsAsked.push(tenantId);
            return countingClient(0, []) as never;
          },
          resolveOrganizationClient: async (organizationId) => {
            organizationsAsked.push(organizationId);
            return countingClient(4210, []) as never;
          },
        },
        processName: "langwatch-api-test",
      });

      await usage
        .ports()
        .getUsageStats(undefined as never, { organizationId: "org-1", user: CALLER });

      // The routing fact: an organization id reaching the tenant resolver is
      // the `UnknownTenantError` this absence was named for.
      expect(organizationsAsked).toEqual(["org-1"]);
      expect(tenantsAsked).toEqual([]);
    });

    /** @scenario "The month's events are read off the organization-keyed rollup" */
    it("reads `billable_events` by OrganizationId, not the trace rollup", async () => {
      const asked: string[] = [];

      const usage = composeApiUsageStats({
        prisma: usagePrisma(null),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async () => countingClient(0, asked) as never,
          resolveOrganizationClient: async () => countingClient(4210, asked) as never,
        },
        processName: "langwatch-api-test",
      });

      await usage
        .ports()
        .getUsageStats(undefined as never, { organizationId: "org-1", user: CALLER });

      expect(asked).toHaveLength(1);
      expect(asked[0]).toContain("FROM billable_events");
      expect(asked[0]).toContain("OrganizationId = {organizationId:String}");
    });
  });

  describe("given a process that opened no ClickHouse", () => {
    /** @scenario "A deployment with no ClickHouse reads the volume as unknown, not as zero" */
    it("reads the events volume as unknown rather than as zero", async () => {
      const usage = composeApiUsageStats({
        prisma: usagePrisma(null),
        plans: composeApiPlanProvider({ isSaas: true }),
        // The two accessors travel together — a process either opened the
        // connection or did not — so there is no half-composed state to test.
        clickhouse: null,
        processName: "langwatch-api-test",
      });

      const stats = await usage
        .ports()
        .getUsageStats(undefined as never, { organizationId: "org-1", user: CALLER });

      // Null, not 0: an unread rollup and an organization that sent nothing
      // are different facts, and the panel says so.
      expect(stats.usageUnit).toBe("events");
      expect(stats.currentMonthMessagesCount).toBeNull();
    });
  });
});
