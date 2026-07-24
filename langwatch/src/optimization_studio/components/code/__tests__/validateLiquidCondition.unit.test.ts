import { describe, expect, it } from "vitest";

import { validateLiquidCondition } from "../validateLiquidCondition";

describe("validateLiquidCondition", () => {
  describe("given a valid condition over a declared input", () => {
    it("reports no error and no missing variables", () => {
      const result = validateLiquidCondition("amount < 5", ["amount"]);
      expect(result.error).toBeUndefined();
      expect(result.missingVariables).toEqual([]);
    });
  });

  describe("given an empty condition", () => {
    it("is treated as valid so it does not nag while typing", () => {
      const result = validateLiquidCondition("   ", ["amount"]);
      expect(result.error).toBeUndefined();
      expect(result.missingVariables).toEqual([]);
    });
  });

  describe("given malformed syntax", () => {
    it("reports a clean error without the if-wrapper or line/col noise", () => {
      const result = validateLiquidCondition(
        "foobar < 5 asdjoiasjdioa 123 %^!",
        ["amount"],
      );
      expect(result.error).toBeTruthy();
      expect(result.error).not.toContain("line:");
      expect(result.error).not.toContain("{% if");
    });
  });

  describe("given a reference to an undeclared variable", () => {
    it("flags it as missing while leaving valid syntax error-free", () => {
      const result = validateLiquidCondition("foobar < 5", ["amount"]);
      expect(result.error).toBeUndefined();
      expect(result.missingVariables).toEqual(["foobar"]);
    });

    it("only flags the undeclared ones in a compound condition", () => {
      const result = validateLiquidCondition("amount > 1 and bar", ["amount"]);
      expect(result.error).toBeUndefined();
      expect(result.missingVariables).toEqual(["bar"]);
    });
  });

  describe("given a nested property access on a declared input", () => {
    it("treats the root variable as known", () => {
      const result = validateLiquidCondition("amount.value > 1", ["amount"]);
      expect(result.error).toBeUndefined();
      expect(result.missingVariables).toEqual([]);
    });
  });
});
