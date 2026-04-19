import { Prisma, type GatewayBudget, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

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

/**
 * Scope-target resolution prism test. Each scope kind hits a different
 * table (organization / team / project / virtualKey / user) and the
 * resolver must return the right shape with the right human-friendly
 * name. Covered under one describe so the full prism is visible.
 */
describe("GatewayBudgetService.getDetail", () => {
  type Findable = { findFirst: unknown; findUnique: unknown; findMany: unknown };
  function mockPrismaWithDetail(
    budget: GatewayBudget | null,
    scopeRow: unknown,
    ledger: unknown[] = [],
  ): PrismaClient {
    return {
      gatewayBudget: {
        findFirst: vi.fn(async () => budget),
      },
      gatewayBudgetLedger: {
        findMany: vi.fn(async () => ledger),
      },
      organization: {
        findUnique: vi.fn(async () => scopeRow),
      },
      team: {
        findUnique: vi.fn(async () => scopeRow),
      },
      project: {
        findUnique: vi.fn(async () => scopeRow),
      },
      virtualKey: {
        findUnique: vi.fn(async () => scopeRow),
      },
      user: {
        findUnique: vi.fn(async () => scopeRow),
      },
    } as unknown as PrismaClient & Record<string, Findable>;
  }

  describe("when the budget does not exist", () => {
    it("returns null", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithDetail(null, null),
      );
      const detail = await sut.getDetail("b_missing", "org_01");
      expect(detail).toBeNull();
    });
  });

  describe("when scope is ORGANIZATION", () => {
    it("resolves the scope target to the org name/slug", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "ORGANIZATION", scopeId: "org_01" }),
          { name: "Acme Inc.", slug: "acme" },
        ),
      );
      const detail = await sut.getDetail("b_01", "org_01");
      expect(detail?.scopeTarget).toEqual({
        kind: "ORGANIZATION",
        id: "org_01",
        name: "Acme Inc.",
        secondary: "acme",
      });
    });
  });

  describe("when scope is VIRTUAL_KEY", () => {
    it("includes the display prefix + project slug for linkback", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "VIRTUAL_KEY", scopeId: "vk_01" }),
          {
            name: "prod-openai",
            displayPrefix: "lw_live_abc",
            project: { slug: "proj" },
          },
        ),
      );
      const detail = await sut.getDetail("b_01", "org_01");
      expect(detail?.scopeTarget).toEqual({
        kind: "VIRTUAL_KEY",
        id: "vk_01",
        name: "prod-openai",
        secondary: "lw_live_abc…",
        projectSlug: "proj",
      });
    });
  });

  describe("when scope is PRINCIPAL", () => {
    it("prefers user.name but falls back to email then id", async () => {
      const sut1 = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "PRINCIPAL", scopeId: "user_42" }),
          { name: "Alex Chen", email: "alex@example.com" },
        ),
      );
      expect((await sut1.getDetail("b_01", "org_01"))?.scopeTarget.name).toBe(
        "Alex Chen",
      );

      const sut2 = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "PRINCIPAL", scopeId: "user_42" }),
          { name: null, email: "alex@example.com" },
        ),
      );
      expect((await sut2.getDetail("b_01", "org_01"))?.scopeTarget.name).toBe(
        "alex@example.com",
      );

      const sut3 = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "PRINCIPAL", scopeId: "user_42" }),
          null,
        ),
      );
      expect((await sut3.getDetail("b_01", "org_01"))?.scopeTarget.name).toBe(
        "user_42",
      );
    });
  });

  describe("when the target row has been deleted", () => {
    it("falls back to the raw scopeId instead of throwing", async () => {
      // Scope FKs are ON DELETE CASCADE, but if the row is stale (null on
      // lookup) the resolver must not null-pointer-crash. Detail page
      // should still render.
      const sut = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget({ scopeType: "TEAM", scopeId: "team_01" }),
          null,
        ),
      );
      const detail = await sut.getDetail("b_01", "org_01");
      expect(detail?.scopeTarget.name).toBe("team_01");
      expect(detail?.scopeTarget.secondary).toBeNull();
    });
  });

  describe("ledger join", () => {
    it("returns the ledger rows limited to the last 20, ordered by occurredAt desc", async () => {
      const sut = GatewayBudgetService.create(
        mockPrismaWithDetail(
          stubBudget(),
          { name: "Proj", slug: "proj" },
          [{ id: "l_01", occurredAt: new Date() }],
        ),
      );
      const detail = await sut.getDetail("b_01", "org_01");
      expect(detail?.recentLedger).toHaveLength(1);
    });
  });
});
