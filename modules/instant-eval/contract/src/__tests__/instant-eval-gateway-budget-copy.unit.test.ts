/**
 * The gateway budget refusal names whose budget it is, and only for a scope it knows.
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */
import { describe, expect, it } from "vitest";

import { InstantEvalGatewayBudgetExceededError } from "../instant-eval.errors.ts";

const refusal = (scope: string) =>
  new InstantEvalGatewayBudgetExceededError({
    budgetId: "budget_1",
    scope,
    window: "MONTH",
    limitUsd: 10,
    spentUsd: 10,
  });

describe("the gateway budget refusal", () => {
  describe("when the scope is one the gateway uses", () => {
    it("names the owner of the budget", () => {
      expect(refusal("project").message).toMatch(/^This project's gateway budget is used up\./);
      expect(refusal("organization").message).toMatch(/^This organization's gateway budget/);
    });
  });

  describe("when the scope is unknown or an inherited property name", () => {
    it("falls back to a gateway budget without leaking inherited text", () => {
      for (const scope of ["toString", "constructor", "virtual_key"]) {
        const { message } = refusal(scope);
        expect(message).toMatch(/^A gateway budget is used up\./);
        expect(message).not.toContain("function");
        expect(message).not.toContain("[native code]");
      }
    });
  });
});
