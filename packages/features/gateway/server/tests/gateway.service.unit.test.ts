import { Prisma } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { GatewayService } from "../src";
import { PrismaGatewayBudgetRepository } from "../src/repositories/prisma/prisma.gateway-budget.repository";
import { TestProjectService } from "./support/test-project-service";

function serviceFor(rows: Array<Record<string, unknown>>): GatewayService {
  const database = {
    virtualKeyScope: { findMany: vi.fn().mockResolvedValue([]) },
    groupMembership: { findMany: vi.fn().mockResolvedValue([]) },
    gatewayBudget: { findMany: vi.fn().mockResolvedValue(rows) },
  };
  return GatewayService.create(
    PrismaGatewayBudgetRepository.create(database),
    new TestProjectService(),
  );
}

function budget(overrides: Record<string, unknown> = {}) {
  return {
    id: "budget_1",
    organizationId: "org_1",
    scopeType: "ORGANIZATION",
    scopeId: "org_1",
    providerKey: null,
    name: "Monthly",
    description: null,
    window: "MONTH",
    limitUsd: new Prisma.Decimal("1.00"),
    onBreach: "BLOCK",
    timezone: null,
    externalId: null,
    metadata: {},
    spentUsd: new Prisma.Decimal("0.50"),
    currentPeriodStartedAt: new Date("2026-01-01T00:00:00.000Z"),
    resetsAt: new Date("2099-01-01T00:00:00.000Z"),
    lastResetAt: null,
    cycleAnchorAt: null,
    archivedAt: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    createdById: "user_1",
    managedByVirtualKeyId: null,
    ...overrides,
  };
}

describe("GatewayService budget decisions", () => {
  it("returns a hard block with the compatibility fields", async () => {
    const service = serviceFor([budget()]);

    await expect(
      service.checkBudget({
        organizationId: "org_1",
        teamId: null,
        projectId: null,
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.50",
      }),
    ).resolves.toEqual({
      decision: "hard_block",
      warnings: [],
      blockReason: "Budget exceeded for scope=organization window=month",
      blockedBy: [
        {
          budgetId: "budget_1",
          scope: "organization",
          scopeId: "org_1",
          window: "month",
          limitUsd: "1",
          spentUsd: "0.500000",
        },
      ],
      scopes: [
        {
          scope: "organization",
          scopeId: "org_1",
          window: "month",
          spentUsd: "0.500000",
          limitUsd: "1.000000",
        },
      ],
    });
  });

  it("filters provider-specific budgets before deciding", async () => {
    const service = serviceFor([
      budget({ id: "all", spentUsd: new Prisma.Decimal("0.90") }),
      budget({
        id: "openai",
        providerKey: "provider_openai",
        spentUsd: new Prisma.Decimal("0.90"),
      }),
    ]);

    await expect(
      service.checkBudget({
        organizationId: "org_1",
        teamId: null,
        projectId: null,
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.01",
        providerKey: "provider_anthropic",
      }),
    ).resolves.toMatchObject({
      decision: "soft_warn",
      blockedBy: [],
      scopes: [{ scope: "organization", scopeId: "org_1" }],
    });
  });
});
