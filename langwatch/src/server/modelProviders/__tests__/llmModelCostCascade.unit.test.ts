import { beforeEach, describe, expect, it, vi } from "vitest";

const { projectFindUnique, costFindMany } = vi.hoisted(() => ({
  projectFindUnique: vi.fn(),
  costFindMany: vi.fn(),
}));

vi.mock("../../db", () => ({
  prisma: {
    project: { findUnique: projectFindUnique },
    customLLMModelCost: { findMany: costFindMany },
  },
}));

import { getLLMModelCosts } from "../llmModelCost";

type Tier = "ORGANIZATION" | "TEAM" | "PROJECT";

const row = (scopeType: Tier, scopeId: string, createdAt: string) => ({
  id: `${scopeType}-${scopeId}-${createdAt}`,
  organizationId: "org_1",
  scopeType,
  scopeId,
  projectId: scopeType === "PROJECT" ? scopeId : null,
  model: "openai/gpt-5-mini",
  regex: "^gpt-5-mini",
  inputCostPerToken: 1,
  outputCostPerToken: 1,
  cacheReadCostPerToken: null,
  cacheCreationCostPerToken: null,
  createdAt: new Date(createdAt),
  updatedAt: new Date(createdAt),
});

describe("getLLMModelCosts cascade", () => {
  beforeEach(() => {
    projectFindUnique.mockReset();
    costFindMany.mockReset();
  });

  describe("given overrides at project, team, and organization tiers", () => {
    beforeEach(() => {
      projectFindUnique.mockResolvedValue({
        id: "proj_1",
        teamId: "team_1",
        team: { organizationId: "org_1" },
      });
      costFindMany.mockResolvedValue([
        row("ORGANIZATION", "org_1", "2026-01-03"),
        row("PROJECT", "proj_1", "2026-01-01"),
        row("TEAM", "team_1", "2026-01-02"),
      ]);
    });

    it("orders most-specific-first: project, then team, then organization", async () => {
      const costs = await getLLMModelCosts({ projectId: "proj_1" });
      const custom = costs.filter((c) => c.id);
      expect(custom.map((c) => c.scopeType)).toEqual([
        "PROJECT",
        "TEAM",
        "ORGANIZATION",
      ]);
    });

    it("places every custom override ahead of the static defaults", async () => {
      const costs = await getLLMModelCosts({ projectId: "proj_1" });
      const firstStaticIndex = costs.findIndex((c) => !c.id);
      const lastCustomIndex = costs.map((c) => Boolean(c.id)).lastIndexOf(true);
      expect(lastCustomIndex).toBeLessThan(firstStaticIndex);
    });

    it("constrains the query to the resolved organization", async () => {
      await getLLMModelCosts({ projectId: "proj_1" });
      expect(costFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ organizationId: "org_1" }),
        }),
      );
    });
  });

  describe("given two overrides at the same tier", () => {
    it("prefers the newest within the tier", async () => {
      projectFindUnique.mockResolvedValue({
        id: "proj_1",
        teamId: "team_1",
        team: { organizationId: "org_1" },
      });
      costFindMany.mockResolvedValue([
        row("PROJECT", "proj_1", "2026-01-01"),
        row("PROJECT", "proj_1", "2026-01-05"),
      ]);
      const costs = await getLLMModelCosts({ projectId: "proj_1" });
      const custom = costs.filter((c) => c.id);
      expect(custom[0]!.createdAt).toEqual(new Date("2026-01-05"));
    });
  });

  describe("when the project does not exist", () => {
    it("returns static defaults only and never queries custom costs", async () => {
      projectFindUnique.mockResolvedValue(null);
      const costs = await getLLMModelCosts({ projectId: "missing" });
      expect(costs.every((c) => !c.id)).toBe(true);
      expect(costFindMany).not.toHaveBeenCalled();
    });
  });
});
