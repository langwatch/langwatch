import { describe, expect, it } from "vitest";
import {
  judgeDeclarationBudget,
  readDeclarationBudgets,
  readFileCount,
  type DeclarationBudget,
} from "../src/tools/declaration-budget.ts";

const budget: DeclarationBudget = {
  directory: "apps/ui",
  files: 9482,
  measuredFiles: 9296,
  package: "@langwatch/ui",
  project: "tsconfig.test.json",
};

describe("given a compiler run's extended diagnostics", () => {
  describe("when the output carries a Files line", () => {
    /** @scenario "The budget check reads the declaration count out of extended diagnostics" */
    it("reads the count, colour codes and all", () => {
      const diagnostics = "[90mFiles:                    9296[0m\nLines: 1340684\n";

      expect(readFileCount(diagnostics)).toBe(9296);
    });
  });

  describe("when the compiler printed no Files line", () => {
    /** @scenario "A run that reported no count is refused rather than read as zero" */
    it("refuses to guess, so the budget cannot pass on a failed run", () => {
      const verdict = judgeDeclarationBudget(budget, readFileCount("error TS5083: cannot read"));

      expect(verdict.state).toBe("unmeasured");
      expect(verdict.state === "unmeasured" && verdict.message).toContain("@langwatch/ui");
    });
  });
});

describe("given a package with a committed budget", () => {
  describe("when it loads fewer declaration files than the budget", () => {
    /** @scenario "A package within its declaration budget passes" */
    it("passes", () => {
      expect(judgeDeclarationBudget(budget, 9296).state).toBe("within");
    });
  });

  describe("when it loads exactly the budget", () => {
    /** @scenario "A package at exactly its declaration budget passes" */
    it("passes, because the budget is the ceiling and not the last value below it", () => {
      expect(judgeDeclarationBudget(budget, 9482).state).toBe("within");
    });
  });

  describe("when it loads more declaration files than the budget", () => {
    /** @scenario "A package over its declaration budget names the growth and the two ways out" */
    it("names the growth, the compiler flag that finds it and the file that records a raise", () => {
      const verdict = judgeDeclarationBudget(budget, 9600);

      expect(verdict.state).toBe("over");
      const message = verdict.state === "over" ? verdict.message : "";
      expect(message).toContain("118 more than its budget of 9482");
      expect(message).toContain("--listFiles");
      expect(message).toContain("declaration-budget.json");
    });
  });
});

describe("given the committed budget file", () => {
  describe("when it is read", () => {
    /** @scenario "Every budget leaves headroom over the count it was measured from" */
    it("gives each application headroom over what it measured, and never less", () => {
      const { budgets } = readDeclarationBudgets(new URL("../../..", import.meta.url).pathname);

      expect(budgets.length).toBeGreaterThan(0);
      for (const entry of budgets) {
        expect(entry.files).toBeGreaterThanOrEqual(entry.measuredFiles);
        expect(entry.files).toBeLessThanOrEqual(Math.ceil(entry.measuredFiles * 1.05));
      }
    });
  });
});
