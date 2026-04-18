import { Prisma, type GatewayBudget, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

import { GatewayBudgetService } from "../budget.service";

function stubBudget(overrides: Partial<GatewayBudget> = {}): GatewayBudget {
  return {
    id: "b_01",
    organizationId: "org_01",
    scopeType: "PROJECT",
    scopeId: "project_01",
    organizationScopedId: null,
    teamScopedId: null,
    projectScopedId: "project_01",
    virtualKeyScopedId: null,
    principalUserId: null,
    name: "monthly",
    description: null,
    window: "MONTH",
    onBreach: "BLOCK",
    limitUsd: new Prisma.Decimal("100.00"),
    spentUsd: new Prisma.Decimal("0.00"),
    timezone: null,
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

function mockPrismaWithBudgets(budgets: GatewayBudget[]): PrismaClient {
  return {
    gatewayBudget: {
      findMany: async () => budgets,
    },
  } as unknown as PrismaClient;
}

const baseCheck = {
  organizationId: "org_01",
  teamId: "team_01",
  projectId: "project_01",
  virtualKeyId: "vk_01",
  principalUserId: null,
};

describe("GatewayBudgetService.check", () => {
  describe("when no budgets are applicable", () => {
    it("returns allow with empty warnings / blockedBy", async () => {
      const sut = GatewayBudgetService.create(mockPrismaWithBudgets([]));

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 5 });

      expect(result.decision).toBe("allow");
      expect(result.warnings).toEqual([]);
      expect(result.blockedBy).toEqual([]);
      expect(result.blockReason).toBeNull();
    });
  });

  describe("when projected spend stays well under limit", () => {
    it("returns allow without warnings", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({ spentUsd: new Prisma.Decimal("10.00") }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 5 });

      expect(result.decision).toBe("allow");
    });
  });

  describe("when projected spend crosses the 80% threshold on a BLOCK budget", () => {
    it("returns soft_warn — warning but not blocked", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({ spentUsd: new Prisma.Decimal("75.00") }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("soft_warn");
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("when projected spend reaches the hard limit on a BLOCK budget", () => {
    it("returns hard_block with a descriptive reason", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({ spentUsd: new Prisma.Decimal("95.00") }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockReason).toMatch(/Budget exceeded/);
    });
  });

  describe("when a WARN budget crosses its limit", () => {
    it("warns but does not block", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({
            onBreach: "WARN",
            spentUsd: new Prisma.Decimal("95.00"),
          }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("soft_warn");
      expect(result.blockedBy).toEqual([]);
    });
  });

  describe("when one BLOCK budget is at limit and another WARN budget is fine", () => {
    it("still hard_blocks (sum-of-breaches semantics)", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({
            id: "b_org",
            scopeType: "ORGANIZATION",
            scopeId: "org_01",
            onBreach: "WARN",
            spentUsd: new Prisma.Decimal("10.00"),
          }),
          stubBudget({
            id: "b_project",
            onBreach: "BLOCK",
            spentUsd: new Prisma.Decimal("95.00"),
          }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy.map((b) => b.budgetId)).toContain("b_project");
    });
  });

  describe("scopes payload (contract §4.4 for Checker.ApplyLive)", () => {
    it("echoes every applicable budget, not just warn/block ones", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({
            id: "b_org",
            scopeType: "ORGANIZATION",
            scopeId: "org_01",
            spentUsd: new Prisma.Decimal("10.00"),
          }),
          stubBudget({
            id: "b_team",
            scopeType: "TEAM",
            scopeId: "team_01",
            spentUsd: new Prisma.Decimal("50.00"),
          }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 1 });

      expect(result.decision).toBe("allow");
      expect(result.scopes).toHaveLength(2);
      expect(result.scopes.map((s) => s.scope).sort()).toEqual([
        "organization",
        "team",
      ]);
      expect(result.scopes[0]).toHaveProperty("spentUsd");
      expect(result.scopes[0]).toHaveProperty("limitUsd");
    });

    it("reports spent_usd as 0 for budgets whose window has rolled over", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({
            spentUsd: new Prisma.Decimal("99.00"),
            resetsAt: new Date("2020-01-01T00:00:00Z"),
          }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 1 });

      expect(result.scopes[0]?.spentUsd).toBe("0.000000");
    });
  });

  describe("when the stale spent_usd indicates the window has reset", () => {
    it("treats effective spent as 0 and allows the request", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithBudgets([
          stubBudget({
            spentUsd: new Prisma.Decimal("99.00"),
            // resetsAt in the past → window has rolled over, stale spent is ignored.
            resetsAt: new Date("2020-01-01T00:00:00Z"),
          }),
        ]),
      );

      const result = await sut.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("allow");
    });
  });
});
