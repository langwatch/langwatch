import type { Organization, PrismaClient } from "@prisma/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DemoOrgScope } from "../_lib/scopeGuard";
import type { SeedActionContext } from "../_lib/seedRunner";

vi.mock("../seed-heavy-usage", () => ({
  runSeedHeavyUsage: vi.fn(),
}));

const ORG_ID = "org_acme1234";

interface PrismaMockShape {
  team: { findMany: ReturnType<typeof vi.fn> };
  virtualKey: { findFirst: ReturnType<typeof vi.fn> };
  gatewayBudget: { findFirst: ReturnType<typeof vi.fn> };
}

function makePrismaMock(shape: {
  personalTeams?: Array<{ id: string; projects: Array<{ id: string }> }>;
  vkByProject?: Record<string, { id: string } | null>;
  budgetByVk?: Record<string, { id: string } | null>;
}): PrismaClient {
  const mock: PrismaMockShape = {
    team: {
      findMany: vi.fn().mockResolvedValue(shape.personalTeams ?? []),
    },
    virtualKey: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(shape.vkByProject?.[where.projectId] ?? null);
      }),
    },
    gatewayBudget: {
      findFirst: vi.fn().mockImplementation(({ where }: any) => {
        return Promise.resolve(shape.budgetByVk?.[where.scopeId] ?? null);
      }),
    },
  };
  return mock as unknown as PrismaClient;
}

function makeContext(execute: boolean, prisma: PrismaClient): SeedActionContext {
  return {
    prisma,
    scope: new DemoOrgScope([ORG_ID]),
    organization: {
      id: ORG_ID,
      name: "ACME",
      slug: "acme",
    } as unknown as Organization,
    execute,
  };
}

describe("seedHeavyUsage SeedAction", () => {
  let runSeedHeavyUsageMock: ReturnType<typeof vi.fn>;
  let seedHeavyUsage: any;

  beforeAll(async () => {
    const seedMod = await import("../seed-heavy-usage");
    runSeedHeavyUsageMock = seedMod.runSeedHeavyUsage as unknown as ReturnType<
      typeof vi.fn
    >;
    const actionMod = await import("../_actions/seedHeavyUsage");
    seedHeavyUsage = actionMod.seedHeavyUsage;
  });

  afterEach(() => {
    runSeedHeavyUsageMock.mockReset();
  });

  describe("when no personal project + VK pair exists in the org", () => {
    it("returns skipped with a clear reason", async () => {
      const prisma = makePrismaMock({ personalTeams: [] });
      const outcome = await seedHeavyUsage.run(makeContext(true, prisma));
      expect(outcome.status).toBe("skipped");
      if (outcome.status === "skipped") {
        expect(outcome.reason).toContain("no demo personas");
      }
      expect(runSeedHeavyUsageMock).not.toHaveBeenCalled();
    });

    it("returns skipped when personal project exists but has no ACTIVE VK", async () => {
      const prisma = makePrismaMock({
        personalTeams: [
          { id: "team_1", projects: [{ id: "proj_persona_1" }] },
        ],
        vkByProject: { proj_persona_1: null },
      });
      const outcome = await seedHeavyUsage.run(makeContext(true, prisma));
      expect(outcome.status).toBe("skipped");
      expect(runSeedHeavyUsageMock).not.toHaveBeenCalled();
    });
  });

  describe("when personas exist", () => {
    const prisma = () =>
      makePrismaMock({
        personalTeams: [
          { id: "team_1", projects: [{ id: "proj_persona_1" }] },
          { id: "team_2", projects: [{ id: "proj_persona_2" }] },
        ],
        vkByProject: {
          proj_persona_1: { id: "vk_1" },
          proj_persona_2: { id: "vk_2" },
        },
        budgetByVk: {
          vk_1: { id: "budget_1" },
          vk_2: null,
        },
      });

    it("returns skipped in dry-run with a row-count estimate", async () => {
      const outcome = await seedHeavyUsage.run(makeContext(false, prisma()));
      expect(outcome.status).toBe("skipped");
      if (outcome.status === "skipped") {
        expect(outcome.reason).toContain("dry-run");
        expect(outcome.reason).toContain("2 personas");
      }
      expect(runSeedHeavyUsageMock).not.toHaveBeenCalled();
    });

    it("invokes runSeedHeavyUsage once per persona with resolved IDs and aggregates the summary", async () => {
      runSeedHeavyUsageMock
        .mockResolvedValueOnce({
          tenantId: "proj_persona_1",
          rowsInserted: 150,
          totalCostUsd: 0.6,
          spanDays: 30,
          budgetSeeded: true,
          byModel: {},
        })
        .mockResolvedValueOnce({
          tenantId: "proj_persona_2",
          rowsInserted: 150,
          totalCostUsd: 0.4,
          spanDays: 30,
          budgetSeeded: false,
          byModel: {},
        });

      const outcome = await seedHeavyUsage.run(makeContext(true, prisma()));

      expect(runSeedHeavyUsageMock).toHaveBeenCalledTimes(2);
      expect(runSeedHeavyUsageMock).toHaveBeenNthCalledWith(1, {
        personalProject: "proj_persona_1",
        virtualKey: "vk_1",
        budget: "budget_1",
        days: 30,
        rows: 150,
      });
      expect(runSeedHeavyUsageMock).toHaveBeenNthCalledWith(2, {
        personalProject: "proj_persona_2",
        virtualKey: "vk_2",
        budget: undefined,
        days: 30,
        rows: 150,
      });
      expect(outcome.status).toBe("succeeded");
      if (outcome.status === "succeeded") {
        expect(outcome.summary).toContain("300 rows");
        expect(outcome.summary).toContain("2 personas");
        expect(outcome.summary).toContain("1 with VK-scoped budgets");
      }
    });
  });
});
