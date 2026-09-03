import { PlanTypes } from "@langwatch/enterprise-billing-contract";
import type { BillingSubscriptionRepository } from "@langwatch/enterprise-billing-server";
import { OrganizationLicensePort } from "@langwatch/enterprise-licensing-server";
import {
  ENTERPRISE_LICENSE_KEY,
  TEST_PUBLIC_KEY,
} from "@langwatch/enterprise-licensing-server/testing";
import { describe, expect, it } from "vitest";
import { OrganizationNotFoundForTeamError } from "@langwatch/entitlement-server";
import {
  ApiEntitlementAbsenceReport,
  composeApiPlanProvider,
  composeApiUsageEnforcement,
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

/**
 * The licence row, as the composition reads it.
 *
 * The KEY is a genuinely signed fixture and the verifier below it is the real
 * one, so what these tests exercise is the whole licence leg: the read, the
 * signature check, the deployment-mode reading and the plan it answers.
 */
function licenses(licenseKey: string | null): OrganizationLicensePort {
  return { tryReadLicense: async () => licenseKey } as OrganizationLicensePort;
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

  describe("given a self-hosted deployment holding the licence row", () => {
    /**
     * The answer a licensed customer's screens are drawn from. Unlicensed and
     * licensed used to be the same plan here, because no licence source was
     * composed at all: every allowance intact, and the Enterprise tier the
     * contract names withheld.
     */
    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names" */
    it("resolves an activated Enterprise licence onto the plan the licence names", async () => {
      const plans = composeApiPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe(PlanTypes.ENTERPRISE);
      expect(plan.planSource).toBe("license");
      expect(plan.free).toBe(false);
      // The seats the customer bought bind, and the licence's message ceiling
      // does not: self-hosted volume is never metered.
      expect(plan.maxMembers).toBe(100);
      expect(plan.maxMessagesPerMonth).toBe(Number.MAX_SAFE_INTEGER);
    });

    /**
     * The tier enricher's whole reason to exist, on the only leg that needs
     * it: the fixture licence was signed before `webhookEndpointsEnabled`
     * existed, so the plan it maps to leaves the field unset and the customer
     * who bought Enterprise is refused the feature Enterprise sells.
     */
    /** @scenario "A licence predating a tier entitlement still carries it" */
    it("fills the webhook entitlement a licence signed before the flag left unanswered", async () => {
      const plans = composeApiPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.webhookEndpointsEnabled).toBe(true);
    });

    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names" */
    it("names no absent licence source, because it composed one", () => {
      const report = new RecordingEntitlementAbsence();

      composeApiPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
        report,
      });

      expect(report.sources).toEqual([]);
    });

    /** @scenario "An unlicensed self-hosted deployment stays unlimited" */
    it("still resolves the unlimited baseline for an organization that activated nothing", async () => {
      const plans = composeApiPlanProvider({
        isSaas: false,
        licenses: licenses(null),
        licensePublicKey: TEST_PUBLIC_KEY,
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe("OPEN_SOURCE");
      expect(plan.free).toBe(true);
      expect(plan.maxMembers).toBe(Number.MAX_SAFE_INTEGER);
    });

    /**
     * A deployment that rotated the verification key and did not name it would
     * refuse its own valid licence, which reads exactly like an unlicensed
     * install. The key is configuration for that reason.
     */
    /** @scenario "An unlicensed self-hosted deployment stays unlimited" */
    it("falls back to the unlimited baseline when the signature does not check out", async () => {
      const plans = composeApiPlanProvider({
        isSaas: false,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe("OPEN_SOURCE");
    });
  });

  describe("given a hosted deployment holding both a licence and a subscription", () => {
    /**
     * A licence on Cloud is the negotiated contract, so it wins over whatever
     * the subscription says. Both processes must agree on that ordering; it is
     * decided once, in `deploymentPlanSources`.
     */
    /** @scenario "A licensed self-hosted deployment resolves the plan its licence names" */
    it("resolves the licence rather than the subscription's plan", async () => {
      const plans = composeApiPlanProvider({
        isSaas: true,
        licenses: licenses(ENTERPRISE_LICENSE_KEY),
        licensePublicKey: TEST_PUBLIC_KEY,
        subscriptions: subscriptions(subscription()),
      });

      const plan = await plans.getActivePlan({ organizationId: "org-1" });

      expect(plan.type).toBe(PlanTypes.ENTERPRISE);
      expect(plan.planSource).toBe("license");
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

/**
 * Enforcement, taken through the REAL composed stack.
 *
 * `composeApiUsageEnforcement` builds the packaged `UsageService` over three
 * things this root writes: the organization directory (team → organization →
 * projects → pricing model), the trace counter and the event counter. Nothing
 * below the ports is a stub, so what these pin is the WIRING — and the wiring
 * has two ways to go silently wrong. The counters can be swapped, which sends
 * an organization id at the tenant-keyed resolver and raises `UnknownTenantError`
 * instead of a count; and the plan resolver can be a second provider, which
 * would meter a paying organization against the free baseline.
 */
function enforcementPrisma(options: {
  organizationId: string | null;
  projectIds: string[];
  pricingModel?: string | null;
}) {
  return {
    team: {
      findUnique: async () =>
        options.organizationId ? { organizationId: options.organizationId } : null,
    },
    project: { findMany: async () => options.projectIds.map((id) => ({ id })) },
    organization: {
      findUnique: async () => ({ pricingModel: options.pricingModel ?? null }),
    },
  } as unknown as Parameters<typeof composeApiUsageEnforcement>[0]["prisma"];
}

/** Answers one `{ projectId, total }` row per project, and records the routing key. */
function breakdownClient(rows: Array<{ projectId: string; total: number }>) {
  return {
    query: async () => ({
      json: async () => rows.map((row) => ({ projectId: row.projectId, total: String(row.total) })),
    }),
  };
}

describe("composeApiUsageEnforcement", () => {
  describe("given a free organization past its monthly event allowance", () => {
    /** @scenario "An organization over its plan's allowance is refused by name" */
    it("refuses, and says which unit and which limit it reached", async () => {
      const enforcement = composeApiUsageEnforcement({
        prisma: enforcementPrisma({ organizationId: "org-1", projectIds: ["project-1"] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async () => countingClient(0, []) as never,
          // The free tier meters in EVENTS, so the breakdown lands here.
          resolveOrganizationClient: async () =>
            breakdownClient([{ projectId: "project-1", total: 60_000 }]) as never,
        },
        isSaas: true,
      });
      if (!enforcement) throw new Error("a composed ClickHouse must compose enforcement");

      const result = await enforcement.checkLimit({ teamId: "team-1" });

      expect(result).toMatchObject({
        exceeded: true,
        count: 60_000,
        maxMessagesPerMonth: 50_000,
        usageUnit: "events",
      });
      // The sentence the SDK is handed. "Free" rather than "Monthly" is the
      // plan provider's answer reaching the message, which is the whole point
      // of composing ONE provider for the panel, the banner and this refusal.
      expect(result.exceeded && result.message).toContain("Free limit of 50000 events reached");
    });

    /** @scenario "The organization id never reaches the tenant resolver" */
    it("reads the events breakdown off the organization accessor, never the tenant one", async () => {
      const organizationsAsked: string[] = [];
      const tenantsAsked: string[] = [];

      const enforcement = composeApiUsageEnforcement({
        prisma: enforcementPrisma({ organizationId: "org-1", projectIds: ["project-1"] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async (tenantId) => {
            tenantsAsked.push(tenantId);
            return countingClient(0, []) as never;
          },
          resolveOrganizationClient: async (organizationId) => {
            organizationsAsked.push(organizationId);
            return breakdownClient([{ projectId: "project-1", total: 60_000 }]) as never;
          },
        },
        isSaas: true,
      });

      await enforcement?.checkLimit({ teamId: "team-1" });

      expect(organizationsAsked).toEqual(["org-1"]);
      expect(tenantsAsked).toEqual([]);
    });
  });

  describe("given a free organization inside its allowance", () => {
    /** @scenario "An organization inside its allowance is not refused" */
    it("does not refuse, so its telemetry is ingested", async () => {
      const enforcement = composeApiUsageEnforcement({
        prisma: enforcementPrisma({ organizationId: "org-1", projectIds: ["project-1"] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async () => countingClient(0, []) as never,
          resolveOrganizationClient: async () =>
            breakdownClient([{ projectId: "project-1", total: 12 }]) as never,
        },
        isSaas: true,
      });

      await expect(enforcement?.checkLimit({ teamId: "team-1" })).resolves.toEqual({
        exceeded: false,
      });
    });
  });

  describe("given a paying organization metered in traces", () => {
    /** @scenario "A trace-metered organization is counted on each project's own endpoint" */
    it("asks each project's OWN endpoint, and holds the plan's higher allowance", async () => {
      const tenantsAsked: string[] = [];

      const enforcement = composeApiUsageEnforcement({
        prisma: enforcementPrisma({
          organizationId: "org-1",
          projectIds: ["project-1", "project-2"],
        }),
        // A paid plan: 20,000 traces a month, and NOT the free tier's events.
        plans: composeApiPlanProvider({
          isSaas: true,
          subscriptions: subscriptions(subscription()),
        }),
        clickhouse: {
          resolveClient: async (tenantId) => {
            tenantsAsked.push(tenantId);
            return countingClient(15_000, []) as never;
          },
          resolveOrganizationClient: async () => {
            throw new Error("a trace-metered organization must not reach the events rollup");
          },
        },
        isSaas: true,
      });

      const result = await enforcement?.checkLimit({ teamId: "team-1" });

      // One read per project, each routed on that project's own id: the trace
      // rollup answers a total over a set of tenants, so a fan-out is what
      // per-tenant routing costs.
      expect(tenantsAsked).toEqual(["project-1", "project-2"]);
      expect(result).toMatchObject({
        exceeded: true,
        count: 30_000,
        maxMessagesPerMonth: 20_000,
        usageUnit: "traces",
      });
    });
  });

  describe("given a team no organization owns", () => {
    /** @scenario "A team that resolves to no organization is not metered against nobody's plan" */
    it("refuses to answer rather than metering traffic against nobody's plan", async () => {
      const enforcement = composeApiUsageEnforcement({
        prisma: enforcementPrisma({ organizationId: null, projectIds: [] }),
        plans: composeApiPlanProvider({ isSaas: true }),
        clickhouse: {
          resolveClient: async () => countingClient(0, []) as never,
          resolveOrganizationClient: async () => countingClient(0, []) as never,
        },
        isSaas: true,
      });

      await expect(enforcement?.checkLimit({ teamId: "team-nobody" })).rejects.toBeInstanceOf(
        OrganizationNotFoundForTeamError,
      );
    });
  });

  describe("given a process that opened no ClickHouse", () => {
    /** @scenario "A deployment with no rollup enforces no allowance" */
    it("composes no enforcement at all, rather than one whose every reading is unknown", () => {
      expect(
        composeApiUsageEnforcement({
          prisma: enforcementPrisma({ organizationId: "org-1", projectIds: ["project-1"] }),
          plans: composeApiPlanProvider({ isSaas: true }),
          clickhouse: null,
          isSaas: true,
        }),
      ).toBeUndefined();
    });
  });
});
