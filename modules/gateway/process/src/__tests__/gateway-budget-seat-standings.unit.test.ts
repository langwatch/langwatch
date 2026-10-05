/**
 * The per-person standing the budgets list, detail page, and management
 * API all read: one computation, not one per renderer. A wrong boundary
 * comparator is invisible on screen and wrong exactly where it matters.
 */

import type { GatewayBudget } from "@langwatch/gateway-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import {
  MemoryGatewayStore,
  memoryGatewayDecimal,
} from "../repositories/memory/memory.gateway.store.ts";
import { memoryBudgetSeed, memoryDebitSeed } from "./support/gateway-memory-seeds.fixture.ts";
import { memoryGatewayService } from "./support/memory.gateway-service.ts";

const TEMPLATE = memoryBudgetSeed({
  id: "bdg_template",
  scopeType: "ATTRIBUTED_USER",
  scopeId: "vk_anchor",
  name: "per person",
  limitUsd: memoryGatewayDecimal("1.00"),
});

const PROJECT_BUDGET = memoryBudgetSeed({ id: "bdg_project" });

/** The service over the memory registry with these budgets and one person's spend per amount. */
async function serviceOver({
  budgets = [TEMPLATE],
  spends = [],
}: {
  budgets?: GatewayBudget[];
  spends?: string[];
}) {
  const store = MemoryGatewayStore.create();
  for (const budget of budgets) store.budgets.set(budget.id, budget);
  const { service, repositories } = memoryGatewayService({
    store,
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => ["project_01"],
      listTraceDestinations: async () => [],
    }),
  });
  for (const [index, amountUsd] of spends.entries()) {
    await repositories.budgetSpend.insertDebit([
      memoryDebitSeed({
        budget: TEMPLATE,
        amountUsd,
        bucketScopeId: `vk_anchor:user${index + 1}`,
        gatewayRequestId: `req_user${index + 1}`,
      }),
    ]);
  }
  return { service, repositories };
}

describe("GatewayService per-person standing", () => {
  describe("when ten people have spent and three have reached the cap", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("reports ten seen and three over", async () => {
      const { service } = await serviceOver({
        // Three at or over $1.00, seven under.
        spends: [
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
        ],
      });

      const [budget] = await service.list("org_01");

      expect(budget?.endUsersSeen).toBe(10);
      expect(budget?.endUsersOver).toBe(3);
    });

    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("counts somebody exactly on their limit as over, matching what the gateway blocks on", async () => {
      const { service } = await serviceOver({ spends: ["0.999999", "1.000000"] });

      const [budget] = await service.list("org_01");

      expect(budget?.endUsersSeen).toBe(2);
      expect(budget?.endUsersOver).toBe(1);
    });
  });

  describe("when a person's usage priced to nothing", () => {
    /** @scenario "A per-person template counts an unpriced user but not a user who only ever failed" */
    it("still counts them as a person the template is watching", async () => {
      const { service, repositories } = await serviceOver({ spends: ["0.000000"] });
      await repositories.budgetSpend.insertDebit([
        memoryDebitSeed({
          budget: TEMPLATE,
          amountUsd: "0.500000",
          bucketScopeId: "vk_anchor:only-failed",
          gatewayRequestId: "req_only_failed",
          status: "PROVIDER_ERROR",
        }),
      ]);

      const [budget] = await service.list("org_01");

      expect(budget?.endUsersSeen).toBe(1);
      expect(budget?.endUsersOver).toBe(0);
    });
  });

  describe("when the template has seen nobody yet", () => {
    /** @scenario "A per-person template nobody has used yet says so instead of showing a dash" */
    it("reports zero seen and zero over rather than leaving the figures absent", async () => {
      const { service } = await serviceOver({});

      const [budget] = await service.list("org_01");

      expect(budget?.endUsersSeen).toBe(0);
      expect(budget?.endUsersOver).toBe(0);
    });
  });

  describe("when the budget list mixes a template with other scopes", () => {
    /** @scenario "A per-person template counts the people it has seen and the people over cap" */
    it("leaves both figures absent on every scope that is not a template", async () => {
      const { service, repositories } = await serviceOver({
        budgets: [TEMPLATE, PROJECT_BUDGET],
        spends: ["2.000000"],
      });
      const breakdownSpy = vi.spyOn(repositories.budgetSpend, "findBucketSpendBreakdownForBudget");

      const budgets = await service.list("org_01");
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
      const { service, repositories } = await serviceOver({ spends: ["2.000000"] });
      vi.spyOn(repositories.budgetSpend, "findBucketSpendBreakdownForBudget").mockRejectedValue(
        new Error("clickhouse unavailable"),
      );

      const { budgets, spendAvailable } = await service.listWithHealth("org_01");

      expect(spendAvailable).toBe(false);
      expect(budgets[0]?.endUsersSeen).toBeUndefined();
      expect(budgets[0]?.endUsersOver).toBeUndefined();
    });
  });
});
