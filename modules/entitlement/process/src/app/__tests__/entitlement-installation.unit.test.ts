import { createApiFixture } from "@langwatch/api-fixture";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import {
  EntitlementApi,
  type EntitlementSource,
  type ListOrganizationSpendInput,
  type Plan,
  type ProjectSpendRollup,
} from "@langwatch/entitlement-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { createTestLogger } from "@langwatch/test-harness";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { entitlementServer } from "../../entitlement.server.ts";
import { MemoryEntitlementDatabase } from "../../repositories/memory/memory.entitlement.database.ts";
import { MemoryOrganizationSpendRepository } from "../../repositories/memory/memory.organization-spend.repository.ts";
import { MemoryUsageMembershipRepository } from "../../repositories/memory/memory.usage-membership.repository.ts";
import type { OrganizationSpendRepository } from "../../repositories/organization-spend.repository.ts";
import {
  createEntitlementTestApp,
  createEntitlementTestUsers,
  fixedEntitlementSource,
  TestUsageWarnings,
} from "./entitlement.fixture.ts";

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

function operatorDirectory(
  profiles: Record<string, { email: string | null; name: string | null }>,
) {
  return createApiFixture<UserApi>({
    findById: async ({ id }) => {
      const profile = profiles[id];
      if (!profile) return null;

      return {
        id,
        name: profile.name,
        email: profile.email,
        emailVerified: true,
        image: null,
        pendingSsoSetup: false,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        lastLoginAt: null,
        deactivatedAt: null,
      };
    },
  });
}

/** A rollup reader that answers nothing and remembers what it was asked. */
class RecordingSpendRepository implements OrganizationSpendRepository {
  readonly asked: ListOrganizationSpendInput[] = [];

  async findSpendRollups(input: ListOrganizationSpendInput): Promise<ProjectSpendRollup[]> {
    this.asked.push(input);

    return [];
  }
}

describe("entitlement app installation", () => {
  /**
   * @scenario "The core baseline works without enterprise sources"
   * `EntitlementApp` declares `reads("logger")` and no subscription
   * dependency at all, and its declared `license` dependency is answered
   * here with a source that never grants — so a plain boot, with no
   * Enterprise billing composed and no active license, still resolves a
   * plan instead of crashing on an undefined baseline (the measured defect:
   * `entitlement.service.ts:70`, "Cannot use 'in' operator to search for
   * 'resolve' in undefined").
   */
  it.each(["api", "worker"] as const)(
    "installs a working capability in the %s role, with no enterprise sources composed",
    async (role) => {
      const { logger } = createTestLogger();
      const runtime = await createApp({ role })
        .withModules([withMemoryRepositories(entitlementServer)])
        .withConfig({ entitlement: { requestBounds: undefined } })
        .withMembers({ isSaas: true, processName: "test" })
        .withObservability((observability) => observability.withLogging(logger))
        .provide({
          user: createEntitlementTestUsers(),
          billing: createApiFixture<BillingApi>({ getActiveSubscriptionPlan: async () => free }),
          licensing: createApiFixture<LicensingApi>({
            resolve: async () => free,
          }),
        })
        .boot();

      try {
        const app = runtime.service(EntitlementApi);

        expect(runtime.module(entitlementServer).provided).toBe(app);

        await expect(
          app.getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({
          type: "FREE",
          planSource: "free",
        });

        // The month's volume needs an Enterprise billing rollup this role
        // never composes, so it answers the honest "could not count" (`null`
        // on the wire) rather than a confident zero.
        await expect(app.getUsage({ organizationId: "organization-1" })).resolves.toMatchObject({
          currentMonthMessagesCount: null,
          membersCount: 0,
          usageUnit: "traces",
        });

        // The approaching-limit mail needs the same Enterprise gateway, so it
        // refuses by name rather than reporting that it sent something.
        await expect(
          app.sendUsageLimitWarning({
            organizationId: "organization-1",
            currentMonthMessagesCount: 900,
            maxMonthlyUsageLimit: 1_000,
          }),
        ).rejects.toMatchObject({ code: "service_unavailable" });
      } finally {
        await runtime.stop();
      }
    },
  );

  describe("given the activated license source a process composition root provided", () => {
    /**
     * Tests what EntitlementApp does once told "licensed" or "not licensed".
     * The licensing service handles the other three "not licensed" causes.
     */
    async function bootWithLicense(source: EntitlementSource) {
      const { logger } = createTestLogger();
      const runtime = await createApp({ role: "api" })
        .withModules([withMemoryRepositories(entitlementServer)])
        .withConfig({ entitlement: { requestBounds: undefined } })
        .withMembers({ isSaas: true, processName: "test" })
        .withObservability((observability) => observability.withLogging(logger))
        .provide({
          user: createEntitlementTestUsers(),
          billing: createApiFixture<BillingApi>({ getActiveSubscriptionPlan: async () => free }),
          licensing: createApiFixture<LicensingApi>({
            resolve: async (input) => (await source.resolve(input)) ?? free,
          }),
        })
        .boot();

      return runtime;
    }

    /** @scenario "A valid signed unexpired Enterprise license resolves the Enterprise plan" */
    it("resolves ENTERPRISE for a valid, unexpired, correctly signed license", async () => {
      const runtime = await bootWithLicense(
        fixedEntitlementSource({
          planSource: "free",
          type: "ENTERPRISE",
          name: "Enterprise",
          free: false,
          maxMembers: 100,
          maxMembersLite: 100,
          maxMessagesPerMonth: 1_000_000,
          canPublish: true,
          prices: { USD: 0, EUR: 0 },
        }),
      );

      try {
        const app = runtime.service(EntitlementApi);

        await expect(
          app.getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({ type: "ENTERPRISE", planSource: "license" });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "An absent license resolves the baseline plan" */
    it("resolves the baseline when no license key is stored for the organization", async () => {
      // Licensing's own absent reading (`LicensePlanSourceService.getActivePlan`)
      // answers a free `PlanInfo`, never `null`, for "no key stored" — the
      // source contract also allows `null`, and either degrades identically
      // here.
      const runtime = await bootWithLicense(fixedEntitlementSource(null));

      try {
        const app = runtime.service(EntitlementApi);

        await expect(
          app.getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({ type: "FREE", planSource: "free" });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "A license with an invalid signature resolves the baseline plan" */
    it("resolves the baseline when the stored license fails signature verification", async () => {
      // Stands in for `LicenseCryptography.validateLicense` answering
      // `{ valid: false }`: Licensing maps that to the same free `PlanInfo`
      // an absent key answers with, so `tryResolvePaidPlan` treats it as
      // unlicensed identically.
      const runtime = await bootWithLicense(
        fixedEntitlementSource({
          planSource: "free",
          type: "OPEN_SOURCE",
          name: "Open Source",
          free: true,
          maxMembers: 5,
          maxMembersLite: 5,
          maxMessagesPerMonth: 1_000,
          canPublish: true,
          prices: { USD: 0, EUR: 0 },
        }),
      );

      try {
        const app = runtime.service(EntitlementApi);

        await expect(
          app.getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({ planSource: "free" });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "An expired license resolves the baseline plan" */
    it("resolves the baseline when the stored license's term has lapsed", async () => {
      // Stands in for the Cloud reading's signature-AND-term check lapsing:
      // `LicensePlanSourceService.getActivePlan` answers the same free
      // `PlanInfo` an invalid signature does, so this seam sees one shape
      // for every "not licensed" cause.
      const runtime = await bootWithLicense(
        fixedEntitlementSource({
          planSource: "free",
          type: "OPEN_SOURCE",
          name: "Open Source",
          free: true,
          maxMembers: 5,
          maxMembersLite: 5,
          maxMessagesPerMonth: 1_000,
          canPublish: true,
          prices: { USD: 0, EUR: 0 },
        }),
      );

      try {
        const app = runtime.service(EntitlementApi);

        await expect(
          app.getActivePlan({ organizationId: "organization-1" }),
        ).resolves.toMatchObject({ planSource: "free" });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("given the installed licensing module", () => {
    /** @scenario "Entitlement resolves licenses through its installed peer" */
    it("declares the exact LicensingApi token supplied by the licensing module", () => {
      expect(entitlementServer.dependencies.license).toBe(LicensingApi);
    });
  });

  describe("given a plan resolved for the operator behind a request", () => {
    /** @scenario "An impersonating operator is resolved through the user directory" */
    it("looks the impersonator's address up before the sources see it", async () => {
      const seen: (string | null | undefined)[] = [];
      const app = createEntitlementTestApp({
        members: {
          baseline: free,
          authorization: {
            resolve: (user) => {
              seen.push(user?.impersonator?.email);

              return {
                overrideAddingLimitations: user?.impersonator?.email === "staff@langwatch.ai",
              };
            },
          },
        },
        dependencies: {
          users: operatorDirectory({
            "user-1": { email: "person@example.com", name: "Person" },
            "staff-1": { email: "staff@langwatch.ai", name: "Staff" },
          }),
        },
      });

      await expect(
        app.getActivePlan({
          organizationId: "organization-1",
          operator: { id: "user-1", impersonatorId: "staff-1" },
        }),
      ).resolves.toMatchObject({ overrideAddingLimitations: true });

      await expect(
        app.getActivePlan({ organizationId: "organization-1", operator: { id: "user-1" } }),
      ).resolves.toMatchObject({ overrideAddingLimitations: false });

      expect(seen).toEqual(["staff@langwatch.ai", undefined]);
    });
  });

  describe("given an approaching-limit warning", () => {
    /** @scenario "An approaching-limit warning reports whether it was sent" */
    it("answers the row it wrote, and reports nothing sent when it wrote none", async () => {
      const sentAt = new Date(0);
      const warnings = TestUsageWarnings.create({
        sent: true,
        notificationId: "notification-1",
        sentAt,
      });
      const app = createEntitlementTestApp({
        members: { baseline: free, warnings },
      });

      await expect(
        app.sendUsageLimitWarning({
          organizationId: "organization-1",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1_000,
        }),
      ).resolves.toEqual({ sent: true, notificationId: "notification-1", sentAt });

      expect(warnings.sent).toHaveLength(1);

      const quiet = createEntitlementTestApp({
        members: { baseline: free, warnings: TestUsageWarnings.create() },
      });

      await expect(
        quiet.sendUsageLimitWarning({
          organizationId: "organization-1",
          currentMonthMessagesCount: 1,
          maxMonthlyUsageLimit: 1_000,
        }),
      ).resolves.toEqual({ sent: false });
    });
  });

  describe("given an organization's spend", () => {
    /** @scenario "Spend is rolled up only for the projects a caller can reach" */
    it("answers the rollups recorded for that caller and none for anybody else", async () => {
      const database = MemoryEntitlementDatabase.create();
      const rollup: ProjectSpendRollup = {
        project: { id: "project-1" },
        costs: [
          {
            projectId: "project-1",
            costType: "TRACE_CHECK",
            currency: "USD",
            _sum: { amount: 4 },
            _count: { id: 2 },
          },
        ],
      };
      database.put({
        organizationId: "organization-1",
        memberCount: 0,
        membersLiteCount: 0,
        currentMonthCost: 0,
        projectCosts: {},
        spendByUserId: { "member-1": [rollup] },
      });

      const app = createEntitlementTestApp({
        repositories: {
          membership: MemoryUsageMembershipRepository.create({ memory: database }),
          spend: MemoryOrganizationSpendRepository.create({ memory: database }),
        },
        members: { baseline: free },
      });

      await expect(
        app.listOrganizationSpend({
          organizationId: "organization-1",
          userId: "member-1",
          startDate: 0,
          endDate: 1,
        }),
      ).resolves.toEqual([rollup]);

      await expect(
        app.listOrganizationSpend({
          organizationId: "organization-1",
          userId: "outsider",
          startDate: 0,
          endDate: 1,
        }),
      ).resolves.toEqual([]);
    });

    /** @scenario "A spend window ending within the last hour is read as up to now" */
    it("pulls a recent end date forward and leaves an older one alone", async () => {
      const spend = new RecordingSpendRepository();
      const app = createEntitlementTestApp({
        repositories: {
          membership: MemoryUsageMembershipRepository.create({
            memory: MemoryEntitlementDatabase.create(),
          }),
          spend,
        },
        members: { baseline: free },
      });

      const now = Date.now();
      await app.listOrganizationSpend({
        organizationId: "organization-1",
        userId: "member-1",
        startDate: now - 86_400_000,
        endDate: now - 60_000,
      });

      const old = now - 86_400_000;
      await app.listOrganizationSpend({
        organizationId: "organization-1",
        userId: "member-1",
        startDate: old - 86_400_000,
        endDate: old,
      });

      expect(spend.asked[0]!.endDate).toBeGreaterThanOrEqual(now);
      expect(spend.asked[1]!.endDate).toBe(old);
    });
  });
});
