/**
 * The per-person standing the budgets list, the detail page, and the
 * management API all read.
 *
 * One computation feeds three surfaces, so the counting rules live here
 * rather than in each renderer: how many people a template has seen, and
 * how many of them the gateway would now refuse. Getting the comparator
 * wrong by one boundary is invisible on screen and wrong in exactly the
 * case that matters, someone sitting exactly on their limit.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type GatewayBudget,
  Prisma,
  type PrismaClient,
} from "~/generated/prisma/client";

import type {
  BucketSpend,
  GatewayBudgetClickHouseRepository,
} from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";
import { nanoUsdToDecimalString, usdToNanoUsd } from "../wireMoney";

function stubTemplate(overrides: Partial<GatewayBudget> = {}): GatewayBudget {
  return {
    id: "bdg_template",
    organizationId: "org_01",
    scopeType: "ATTRIBUTED_USER",
    scopeId: "vk_anchor",
    name: "per person",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: new Prisma.Decimal("1.00"),
    spentUsd: new Prisma.Decimal("0.00"),
    timezone: null,
    providerKey: null,
    resetsAt: new Date("2099-01-01T00:00:00Z"),
    currentPeriodStartedAt: new Date(),
    lastResetAt: null,
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    createdById: "user_01",
    ...overrides,
  } as GatewayBudget;
}

function stubProjectBudget(): GatewayBudget {
  return stubTemplate({
    id: "bdg_project",
    scopeType: "PROJECT",
    scopeId: "project_01",
    limitUsd: new Prisma.Decimal("100.00"),
  });
}

function bucketsOf(...spends: string[]): BucketSpend[] {
  return spends.map((usd, i) => {
    const spentNanoUsd = Number(usdToNanoUsd(usd));
    return {
      scopeId: `vk_anchor:user${i + 1}`,
      spentNanoUsd,
      spentUsd: nanoUsdToDecimalString(spentNanoUsd),
    };
  });
}

function mockPrisma(budgets: GatewayBudget[], boundaries: unknown[] = []) {
  return {
    gatewayBudget: { findMany: async () => budgets },
    project: { findMany: async () => [{ id: "project_01" }] },
    gatewayBudgetBucketBoundary: { findMany: async () => boundaries },
    // Scope reach rides along on the health-decorated list paths.
    virtualKey: { findMany: async () => [] },
  } as unknown as PrismaClient;
}

function mockChRepo(args: {
  breakdown?: BucketSpend[];
  breakdownSpy?: ReturnType<typeof vi.fn>;
  throwOnBreakdown?: boolean;
}): GatewayBudgetClickHouseRepository {
  return {
    getSpendForBudgetsAcrossTenants: async () => [],
    getBucketSpendBreakdownForBudget:
      args.breakdownSpy ??
      (async () => {
        if (args.throwOnBreakdown) throw new Error("clickhouse unavailable");
        return args.breakdown ?? [];
      }),
  } as unknown as GatewayBudgetClickHouseRepository;
}

describe("GatewayBudgetService per-person standing", () => {
  describe("when ten people have spent and three have reached the cap", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("reports ten seen and three over", async () => {
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate()]),
        mockChRepo({
          // Three at or over $1.00, seven under.
          breakdown: bucketsOf(
            "1.000000",
            "1.500000",
            "2.000000",
            "0.100000",
            "0.200000",
            "0.300000",
            "0.400000",
            "0.500000",
            "0.600000",
            "0.700000",
          ),
        }),
      );

      const [budget] = await sut.list("org_01");

      expect(budget?.endUsersSeen).toBe(10);
      expect(budget?.endUsersOver).toBe(3);
    });

    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("counts somebody exactly on their limit as over, matching what the gateway blocks on", async () => {
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate()]),
        mockChRepo({ breakdown: bucketsOf("0.999999", "1.000000") }),
      );

      const [budget] = await sut.list("org_01");

      expect(budget?.endUsersSeen).toBe(2);
      expect(budget?.endUsersOver).toBe(1);
    });
  });

  describe("when a person's usage priced to nothing", () => {
    /** @scenario "A per-person template counts an unpriced user but not a user who only ever failed" */
    it("still counts them as a person the template is watching", async () => {
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate()]),
        mockChRepo({ breakdown: bucketsOf("0.000000") }),
      );

      const [budget] = await sut.list("org_01");

      expect(budget?.endUsersSeen).toBe(1);
      expect(budget?.endUsersOver).toBe(0);
    });
  });

  describe("when the template has seen nobody yet", () => {
    /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
    it("reports zero seen and zero over rather than leaving the figures absent", async () => {
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate()]),
        mockChRepo({ breakdown: [] }),
      );

      const [budget] = await sut.list("org_01");

      expect(budget?.endUsersSeen).toBe(0);
      expect(budget?.endUsersOver).toBe(0);
    });
  });

  describe("when the budget list mixes a template with other scopes", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("leaves both figures absent on every scope that is not a template", async () => {
      const breakdownSpy = vi.fn(async () => bucketsOf("2.000000"));
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate(), stubProjectBudget()]),
        mockChRepo({ breakdownSpy }),
      );

      const budgets = await sut.list("org_01");
      const template = budgets.find((b) => b.scopeType === "ATTRIBUTED_USER");
      const projectBudget = budgets.find((b) => b.scopeType === "PROJECT");

      expect(template?.endUsersSeen).toBe(1);
      expect(projectBudget?.endUsersSeen).toBeUndefined();
      expect(projectBudget?.endUsersOver).toBeUndefined();
      // One read per template, and none for anything else.
      expect(breakdownSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("when the per-bucket read cannot reach ClickHouse", () => {
    /** @scenario "A budget whose spend cannot be totalled says so instead of showing zero" */
    it("degrades the whole list to spend-unavailable rather than showing a made-up headcount", async () => {
      const sut = GatewayBudgetService.create(
        mockPrisma([stubTemplate()]),
        mockChRepo({ throwOnBreakdown: true }),
      );

      const { budgets, spendAvailable } = await sut.listWithHealth("org_01");

      expect(spendAvailable).toBe(false);
      expect(budgets[0]?.endUsersSeen).toBeUndefined();
      expect(budgets[0]?.endUsersOver).toBeUndefined();
    });
  });
});
