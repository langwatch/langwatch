import type { GatewayBudget } from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
  type MemoryGatewaySeed,
} from "../repositories/memory/memory.gateway.store.ts";
import {
  memoryBudgetSeed,
  memoryDebitSeed,
  memoryVirtualKeySeed,
} from "./support/gateway-memory-seeds.fixture.ts";
import { memoryGatewayService } from "./support/memory.gateway-service.ts";

/** A budget and the spend its own bucket has seen this period, in USD. */
type SeededBudget = { budget: GatewayBudget; spentUsd?: string };

/** The service over the memory registry with these budgets, their spend and rows others own. */
async function serviceOver({
  budgets = [],
  seed = {},
}: {
  budgets?: SeededBudget[];
  seed?: MemoryGatewaySeed;
} = {}) {
  const store = MemoryGatewayStore.create(seed);
  for (const { budget } of budgets) store.budgets.set(budget.id, budget);
  const { service, repositories } = memoryGatewayService({
    store,
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => ["project_01"],
      listNamesByIds: async () => [
        {
          id: "project_01",
          name: "Proj",
          slug: "proj",
          teamId: "team_01",
          organizationId: "org_01",
          isPersonal: false,
          ownerUserId: null,
        },
      ],
      listTraceDestinations: async () => [],
    }),
  });
  for (const { budget, spentUsd } of budgets) {
    if (spentUsd === undefined) continue;
    await repositories.budgetSpend.insertDebit([
      memoryDebitSeed({ budget, amountUsd: spentUsd, gatewayRequestId: `req_${budget.id}` }),
    ]);
  }
  return { service, repositories, store };
}

const baseCheck = {
  organizationId: "org_01",
  teamId: "team_01",
  projectId: "project_01",
  virtualKeyId: "vk_01",
  principalUserId: null,
};

describe("GatewayService.check", () => {
  describe("given an applicable budget filtered to one provider", () => {
    describe("when the Gateway checks a request dispatched to another provider", () => {
      /** @scenario "Provider-filtered budgets only apply to their provider" */
      it("leaves that budget out of the scopes it answers with", async () => {
        const { service } = await serviceOver({
          budgets: [{ budget: memoryBudgetSeed({ providerKey: "mp_openai" }) }],
        });

        const forItsOwnProvider = await service.check({
          ...baseCheck,
          projectedCostUsd: 1,
          providerKey: "mp_openai",
        });
        const forAnother = await service.check({
          ...baseCheck,
          projectedCostUsd: 1,
          providerKey: "mp_anthropic",
        });

        expect(forItsOwnProvider.scopes).toHaveLength(1);
        expect(forItsOwnProvider.scopes[0]).toMatchObject({ scopeId: "project_01" });
        expect(forAnother.scopes).toEqual([]);
      });

      /** @scenario "Provider-filtered budgets only apply to their provider" */
      it("refuses to attribute a dispatch that named no provider to a filtered budget", async () => {
        const { service } = await serviceOver({
          budgets: [
            { budget: memoryBudgetSeed({ providerKey: "mp_openai" }) },
            {
              budget: memoryBudgetSeed({
                id: "b_02",
                providerKey: null,
                limitUsd: memoryGatewayDecimal("50.00"),
              }),
            },
          ],
        });

        const result = await service.check({ ...baseCheck, projectedCostUsd: 1 });

        // Only the unfiltered budget answers: attributing an unattributed
        // dispatch to the OpenAI-filtered one would be a guess.
        expect(result.scopes).toHaveLength(1);
        expect(result.scopes[0]!.limitUsd).toBe("50.000000");
      });
    });
  });

  describe("when no budgets are applicable", () => {
    it("returns allow with empty warnings / blockedBy", async () => {
      const { service } = await serviceOver();

      const result = await service.check({ ...baseCheck, projectedCostUsd: 5 });

      expect(result.decision).toBe("allow");
      expect(result.warnings).toEqual([]);
      expect(result.blockedBy).toEqual([]);
      expect(result.blockReason).toBeNull();
    });
  });

  describe("when projected spend stays well under limit", () => {
    it("returns allow without warnings", async () => {
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed(), spentUsd: "10.00" }],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 5 });

      expect(result.decision).toBe("allow");
    });
  });

  describe("when projected spend crosses the 80% threshold on a BLOCK budget", () => {
    it("returns soft_warn — warning but not blocked", async () => {
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed(), spentUsd: "75.00" }],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("soft_warn");
      expect(result.warnings).toHaveLength(1);
    });
  });

  describe("when projected spend reaches the hard limit on a BLOCK budget", () => {
    /** @scenario Hard-block budget returns 402 when spent >= limit */
    /** @scenario "A projected request reaches a hard budget limit" */
    it("returns hard_block with a descriptive reason", async () => {
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed(), spentUsd: "95.00" }],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy).toHaveLength(1);
      expect(result.blockReason).toMatch(/Budget exceeded/);
    });
  });

  // Regression (iter-111): after the ledger cutover, spentUsd is a dormant
  // column. check() read live spend into scopes[], but blockedBy[] used to
  // still read the stale column, understating reported spend.
  describe("when the ledger holds spend and the dormant spentUsd column reads zero", () => {
    it("reports blockedBy[].spentUsd from the ledger, not from the dormant column", async () => {
      const { service } = await serviceOver({
        budgets: [
          {
            budget: memoryBudgetSeed({
              id: "b_ledger_sourced",
              spentUsd: memoryGatewayDecimal("0.00"),
            }),
            spentUsd: "95",
          },
        ],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy).toHaveLength(1);
      // The ledger figure wins, not the zero from the dormant column.
      expect(result.blockedBy[0]!.spentUsd).toBe("95.000000");
      // And scopes[] must agree — same source of truth across both lists.
      const scopeLine = result.scopes.find(
        (s) => s.scope === "project" && s.scopeId === "project_01",
      );
      expect(scopeLine?.spentUsd).toBe("95.000000");
    });
  });

  describe("when a WARN budget crosses its limit", () => {
    /** @scenario Soft budget emits warning header but allows the call */
    it("warns but does not block", async () => {
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed({ onBreach: "WARN" }), spentUsd: "95.00" }],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("soft_warn");
      expect(result.blockedBy).toEqual([]);
    });
  });

  describe("when one BLOCK budget is at limit and another WARN budget is fine", () => {
    /** @scenario Sum-of-breaches rule — any block-breach blocks */
    /** @scenario Most restrictive budget wins when multiple apply */
    it("still hard_blocks (sum-of-breaches semantics)", async () => {
      const { service } = await serviceOver({
        budgets: [
          {
            budget: memoryBudgetSeed({
              id: "b_org",
              scopeType: "ORGANIZATION",
              scopeId: "org_01",
              onBreach: "WARN",
            }),
            spentUsd: "10.00",
          },
          { budget: memoryBudgetSeed({ id: "b_project", onBreach: "BLOCK" }), spentUsd: "95.00" },
        ],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("hard_block");
      expect(result.blockedBy.map((b) => b.budgetId)).toContain("b_project");
    });
  });

  describe("given the scopes payload (contract §4.4 for Checker.ApplyLive)", () => {
    it("echoes every applicable budget, not just warn/block ones", async () => {
      const { service } = await serviceOver({
        budgets: [
          {
            budget: memoryBudgetSeed({
              id: "b_org",
              scopeType: "ORGANIZATION",
              scopeId: "org_01",
            }),
            spentUsd: "10.00",
          },
          {
            budget: memoryBudgetSeed({ id: "b_team", scopeType: "TEAM", scopeId: "team_01" }),
            spentUsd: "50.00",
          },
        ],
      });

      const result = await service.check({ ...baseCheck, projectedCostUsd: 1 });

      expect(result.decision).toBe("allow");
      expect(result.scopes).toHaveLength(2);
      expect(result.scopes.map((s) => s.scope).toSorted()).toEqual(["organization", "team"]);
      expect(result.scopes[0]).toHaveProperty("spentUsd");
      expect(result.scopes[0]).toHaveProperty("limitUsd");
    });

    it("reports spent_usd as 0 for budgets whose window has rolled over", async () => {
      const { service } = await rolledOverService();

      const result = await service.check({ ...baseCheck, projectedCostUsd: 1 });

      expect(result.scopes[0]?.spentUsd).toBe("0.000000");
    });
  });

  describe("when the stored period has rolled over since the spend landed", () => {
    it("treats effective spent as 0 and allows the request", async () => {
      const { service } = await rolledOverService();

      const result = await service.check({ ...baseCheck, projectedCostUsd: 10 });

      expect(result.decision).toBe("allow");
    });
  });
});

/** A budget whose stored period ended in 2020, holding $99 of spend from a period now closed. */
async function rolledOverService() {
  const budget = memoryBudgetSeed({
    currentPeriodStartedAt: Temporal.Instant.from("2019-12-01T00:00:00Z"),
    resetsAt: Temporal.Instant.from("2020-01-01T00:00:00Z"),
  });
  const fixture = await serviceOver({ budgets: [{ budget }] });
  await fixture.repositories.budgetSpend.insertDebit([
    memoryDebitSeed({
      budget,
      amountUsd: "99.00",
      gatewayRequestId: "req_last_period",
      occurredAt: nowInstant().subtract({ hours: 24 * 40 }),
    }),
  ]);
  return fixture;
}

/**
 * Scope-target resolution prism: each scope kind (org/team/project/
 * virtualKey/user) resolves the right shape and human-friendly name.
 */
describe("GatewayService.findDetailById", () => {
  describe("when the budget does not exist", () => {
    it("returns null", async () => {
      const { service } = await serviceOver();
      const detail = await service.findDetailById({ id: "b_missing", organizationId: "org_01" });
      expect(detail).toBeNull();
    });
  });

  describe("when scope is ORGANIZATION", () => {
    it("resolves the scope target to the org name/slug", async () => {
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed({ scopeType: "ORGANIZATION", scopeId: "org_01" }) }],
        seed: { organizations: [{ id: "org_01", name: "Acme Inc.", slug: "acme" }] },
      });
      const detail = await service.findDetailById({ id: "b_01", organizationId: "org_01" });
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
      // The VK's PROJECT scope points at project_01, whose slug comes
      // back from the batch resolver's slug map.
      const { service, repositories } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed({ scopeType: "VIRTUAL_KEY", scopeId: "vk_01" }) }],
      });
      await repositories.virtualKeys.create({
        ...memoryVirtualKeySeed({ id: "vk_01", name: "prod-openai", organizationId: "org_01" }),
        displayPrefix: "lw_live_abc",
        scopes: [{ scopeType: "PROJECT", scopeId: "project_01" }],
      });
      const detail = await service.findDetailById({ id: "b_01", organizationId: "org_01" });
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
    const principalBudget = [
      { budget: memoryBudgetSeed({ scopeType: "PRINCIPAL", scopeId: "user_42" }) },
    ];
    const nameOf = async (users: MemoryGatewaySeed["users"]) => {
      const { service } = await serviceOver({ budgets: principalBudget, seed: { users } });
      return (await service.findDetailById({ id: "b_01", organizationId: "org_01" }))?.scopeTarget
        .name;
    };
    const member = { id: "user_42", organizationIds: ["org_01"] };

    it("prefers user.name but falls back to email then id", async () => {
      expect(await nameOf([{ ...member, name: "Alex Chen", email: "alex@example.com" }])).toBe(
        "Alex Chen",
      );
      expect(await nameOf([{ ...member, name: null, email: "alex@example.com" }])).toBe(
        "alex@example.com",
      );
      expect(await nameOf([])).toBe("user_42");
    });
  });

  describe("when the target row has been deleted", () => {
    it("falls back to the raw scopeId instead of throwing", async () => {
      // Scope FKs are ON DELETE CASCADE, but if the row is stale the
      // resolver must not crash: the detail page should still render.
      const { service } = await serviceOver({
        budgets: [{ budget: memoryBudgetSeed({ scopeType: "TEAM", scopeId: "team_01" }) }],
      });
      const detail = await service.findDetailById({ id: "b_01", organizationId: "org_01" });
      expect(detail?.scopeTarget.name).toBe("team_01");
      expect(detail?.scopeTarget.secondary).toBeNull();
    });
  });

  describe("when joining the ledger", () => {
    it("returns the ledger rows limited to the last 20, ordered by occurredAt desc", async () => {
      const budget = memoryBudgetSeed();
      const { service, repositories } = await serviceOver({ budgets: [{ budget }] });
      const now = nowInstant();
      for (let minutesAgo = 0; minutesAgo < 21; minutesAgo += 1) {
        await repositories.budgetSpend.insertDebit([
          memoryDebitSeed({
            budget,
            amountUsd: "0.01",
            gatewayRequestId: `l_${minutesAgo.toString().padStart(2, "0")}`,
            occurredAt: now.subtract({ minutes: minutesAgo }),
          }),
        ]);
      }

      const detail = await service.findDetailById({ id: "b_01", organizationId: "org_01" });

      expect(detail?.recentLedger).toHaveLength(20);
      expect(detail?.recentLedger.map((row) => row.id)).toEqual(
        Array.from(
          { length: 20 },
          (_, minutesAgo) => `l_${minutesAgo.toString().padStart(2, "0")}`,
        ),
      );
    });
  });
});
