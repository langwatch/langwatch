import { describe, expect, it } from "vitest";

import { gatewayBudgetCheckInputSchema, gatewayBudgetCheckResultSchema } from "../index.ts";

describe("gateway contract", () => {
  it("requires request scope context at the boundary", () => {
    expect(
      gatewayBudgetCheckInputSchema.validate({
        organizationId: "org_1",
        teamId: null,
        projectId: null,
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.01",
      }),
    ).toBe(true);
    expect(
      gatewayBudgetCheckInputSchema.validate({
        organizationId: "org_1",
        virtualKeyId: "vk_1",
        projectedCostUsd: "0.01",
      }),
    ).toBe(false);
  });

  /** @scenario "A projected request reaches a hard budget limit" */
  it("locks the compatibility response fields", () => {
    const result = {
      decision: "hard_block" as const,
      warnings: [],
      blockReason: "Budget exceeded",
      blockedBy: [
        {
          budgetId: "budget_1",
          scope: "organization",
          scopeId: "org_1",
          window: "month",
          limitUsd: "1.000000",
          spentUsd: "1.000000",
        },
      ],
      scopes: [
        {
          scope: "organization",
          scopeId: "org_1",
          window: "month",
          spentUsd: "1.000000",
          limitUsd: "1.000000",
        },
      ],
    };
    expect(gatewayBudgetCheckResultSchema.parse(result)).toEqual(result);
    expect(gatewayBudgetCheckResultSchema.validate({ ...result, extra: true })).toBe(false);
  });
});
