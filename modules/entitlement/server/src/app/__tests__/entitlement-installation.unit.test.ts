import {
  EntitlementApi,
  type ListOrganizationSpendInput,
  type Plan,
  type ProjectSpendRollup,
} from "@langwatch/entitlement-contract";
import { createApp, withMemoryRepositories } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";
import { entitlementServer } from "../../entitlement.server.ts";
import type { OrganizationSpendRepository } from "../../repositories/organization-spend.repository.ts";
import { MemoryEntitlementDatabase } from "../../repositories/memory/memory.entitlement.database.ts";
import { MemoryOrganizationSpendRepository } from "../../repositories/memory/memory.organization-spend.repository.ts";
import { MemoryUsageMembershipRepository } from "../../repositories/memory/memory.usage-membership.repository.ts";
import {
  createEntitlementTestApp,
  createEntitlementTestUsers,
  TestUsageCounter,
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
    tryFindById: async ({ id }) => {
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
  it("installs a working capability in the api role", async () => {
    const runtime = await createApp({ role: "api", config: {} })
      .withInfrastructure({
        baseline: free,
        counter: TestUsageCounter.create(120),
        warnings: TestUsageWarnings.create(),
      })
      .withProvided(UserApi, createEntitlementTestUsers())
      .withModules([withMemoryRepositories(entitlementServer)])
      .boot();

    try {
      const app = runtime.service(EntitlementApi);

      expect(runtime.module(entitlementServer).provided).toBe(app);

      await expect(app.getActivePlan({ organizationId: "organization-1" })).resolves.toMatchObject({
        type: "FREE",
        planSource: "free",
      });

      await expect(app.getUsage({ organizationId: "organization-1" })).resolves.toMatchObject({
        currentMonthMessagesCount: 120,
        membersCount: 0,
        usageUnit: "traces",
      });
    } finally {
      await runtime.stop();
    }
  });

  describe("given a plan resolved for the operator behind a request", () => {
    /** @scenario "An impersonating operator is resolved through the user directory" */
    it("looks the impersonator's address up before the sources see it", async () => {
      const seen: Array<string | null | undefined> = [];
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
