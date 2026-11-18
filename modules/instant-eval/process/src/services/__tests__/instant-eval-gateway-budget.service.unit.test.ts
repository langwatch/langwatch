/**
 * The gateway budgets a customer set to block, asked before Instant Evals judge.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import type {
  GatewayBudgetCheckInput,
  GatewayBudgetCheckResult,
} from "@langwatch/gateway-contract";
import { InstantEvalGatewayBudgetExceededError } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import { InstantEvalGatewayBudgetService } from "../instant-eval-gateway-budget.service.ts";

/** One project budget, judged the way the gateway's preflight judges it. */
interface ProjectBudget {
  readonly limitUsd: number;
  readonly spentUsd: number;
  readonly onBreach: "BLOCK" | "WARN";
}

function checkAgainst(budget: ProjectBudget | undefined) {
  const asked: GatewayBudgetCheckInput[] = [];
  const checkBudget = async (input: GatewayBudgetCheckInput): Promise<GatewayBudgetCheckResult> => {
    asked.push(input);
    const empty = { warnings: [], blockReason: null, blockedBy: [], scopes: [] };
    if (!budget) return { decision: "allow", ...empty };
    const projected = budget.spentUsd + Number(input.projectedCostUsd);
    if (projected < budget.limitUsd) return { decision: "allow", ...empty };
    const warning = { scope: "project", pctUsed: 100, limitUsd: String(budget.limitUsd) };
    if (budget.onBreach === "WARN") return { decision: "soft_warn", ...empty, warnings: [warning] };

    return {
      decision: "hard_block",
      ...empty,
      blockReason: "Budget exceeded for scope=project window=month",
      blockedBy: [
        {
          budgetId: "budget-1",
          scope: "project",
          scopeId: "project-1",
          window: "month",
          limitUsd: String(budget.limitUsd),
          spentUsd: budget.spentUsd.toFixed(6),
        },
      ],
    };
  };

  return { asked, checkBudget };
}

function serviceWith({
  budget,
  isOwnDecisionModel = false,
}: {
  budget?: ProjectBudget;
  isOwnDecisionModel?: boolean;
}) {
  const { asked, checkBudget } = checkAgainst(budget);
  const service = InstantEvalGatewayBudgetService.create({
    peers: {
      findSpendAttribution: async () => ({ organizationId: "org-1", teamId: "team-1" }),
      checkBudget,
      isOwnDecisionModel: async () => isOwnDecisionModel,
    },
  });

  return { service, asked };
}

describe("given a project budget set to block", () => {
  describe("when its spend is at its limit", () => {
    /** @scenario "A run is refused once a blocking budget is reached" */
    it("refuses, naming the budget, its scope, window, limit and spend", async () => {
      const { service } = serviceWith({
        budget: { limitUsd: 5, spentUsd: 5, onBreach: "BLOCK" },
      });

      const error = await service
        .assertWithinGatewayBudget({ projectId: "project-1" })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(InstantEvalGatewayBudgetExceededError);
      expect(error).toMatchObject({
        code: "instant_eval_gateway_budget_exceeded",
        httpStatus: 402,
        meta: { budgetId: "budget-1", scope: "project", window: "month", limitUsd: 5, spentUsd: 5 },
      });
    });

    it("asks for the project under a key no key budget names, with no person or provider", async () => {
      const { service, asked } = serviceWith({});

      await service.assertWithinGatewayBudget({ projectId: "project-1" });

      expect(asked).toEqual([
        {
          organizationId: "org-1",
          teamId: "team-1",
          projectId: "project-1",
          virtualKeyId: "_instant_eval_:project:project-1",
          principalUserId: null,
          providerKey: null,
          projectedCostUsd: 0,
        },
      ]);
    });
  });

  describe("when its spend is under the limit", () => {
    it("lets the run start", async () => {
      const { service } = serviceWith({
        budget: { limitUsd: 5, spentUsd: 4.5, onBreach: "BLOCK" },
      });

      await expect(
        service.assertWithinGatewayBudget({ projectId: "project-1" }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when a run's own spend so far would take it to the limit", () => {
    /** @scenario "A run under way stops between pages once its spend reaches a blocking budget" */
    it("projects that spend onto the budget and refuses", async () => {
      const { service, asked } = serviceWith({
        budget: { limitUsd: 5, spentUsd: 4.5, onBreach: "BLOCK" },
      });

      await expect(
        service.assertWithinGatewayBudget({ projectId: "project-1", inFlightUsd: 0.5 }),
      ).rejects.toBeInstanceOf(InstantEvalGatewayBudgetExceededError);
      expect(asked[0]?.projectedCostUsd).toBe(0.5);
    });
  });
});

describe("given a per-end-user budget on the project set to block", () => {
  describe("when the run's spend so far would take one end user's share past it", () => {
    it("lets the run go on, as it has no end user to charge", async () => {
      const service = InstantEvalGatewayBudgetService.create({
        peers: {
          findSpendAttribution: async () => ({ organizationId: "org-1", teamId: "team-1" }),
          checkBudget: async () => ({
            decision: "hard_block",
            warnings: [],
            blockReason: "Budget exceeded for scope=attributed_user window=day",
            blockedBy: [
              {
                budgetId: "budget-2",
                scope: "attributed_user",
                scopeId: "project-1",
                window: "day",
                limitUsd: "0.100000",
                spentUsd: "0.000000",
              },
            ],
            scopes: [],
          }),
          isOwnDecisionModel: async () => false,
        },
      });

      await expect(
        service.assertWithinGatewayBudget({ projectId: "project-1", inFlightUsd: 0.2 }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given a project budget set to warn", () => {
  describe("when its spend is past its limit", () => {
    /** @scenario "A budget set to warn never refuses a run" */
    it("lets the run start", async () => {
      const { service } = serviceWith({
        budget: { limitUsd: 5, spentUsd: 9, onBreach: "WARN" },
      });

      await expect(
        service.assertWithinGatewayBudget({ projectId: "project-1" }),
      ).resolves.toBeUndefined();
    });
  });
});

describe("given a project on its own decision model", () => {
  describe("when its blocking budget is reached", () => {
    /** @scenario "A run on the project's own decision model is not checked" */
    it("never asks the gateway, whose ledger does not carry that cost", async () => {
      const { service, asked } = serviceWith({
        budget: { limitUsd: 5, spentUsd: 5, onBreach: "BLOCK" },
        isOwnDecisionModel: true,
      });

      await expect(
        service.assertWithinGatewayBudget({ projectId: "project-1" }),
      ).resolves.toBeUndefined();
      expect(asked).toEqual([]);
    });
  });
});

describe("given a project with no team", () => {
  it("has no budget to ask", async () => {
    const asked: GatewayBudgetCheckInput[] = [];
    const service = InstantEvalGatewayBudgetService.create({
      peers: {
        findSpendAttribution: async () => undefined,
        checkBudget: async (input) => {
          asked.push(input);
          return { decision: "allow", warnings: [], blockReason: null, blockedBy: [], scopes: [] };
        },
        isOwnDecisionModel: async () => false,
      },
    });

    await expect(
      service.assertWithinGatewayBudget({ projectId: "project-1" }),
    ).resolves.toBeUndefined();
    expect(asked).toEqual([]);
  });
});
