import { describe, expect, it } from "vitest";

import { dynamicRunConcurrency } from "../experiment-run-concurrency.rules.ts";

describe("dynamicRunConcurrency", () => {
  describe("given an idle project with a budget above 24", () => {
    /** @scenario "An idle project gets the full project budget, capped at 24" */
    it("answers 24", () => {
      expect(
        dynamicRunConcurrency({ projectActiveRuns: 0, globalActiveRuns: 0, projectBudget: 40 }),
      ).toBe(24);
    });
  });

  describe("given one other run active in the project", () => {
    /** @scenario "A second active run in the project halves the default" */
    it("answers half the budget", () => {
      expect(
        dynamicRunConcurrency({ projectActiveRuns: 1, globalActiveRuns: 1, projectBudget: 20 }),
      ).toBe(10);
    });
  });

  describe("given more active runs than the budget has cells", () => {
    /** @scenario "The default concurrency is never below 1" */
    it("answers 1", () => {
      expect(
        dynamicRunConcurrency({ projectActiveRuns: 9, globalActiveRuns: 9, projectBudget: 4 }),
      ).toBe(1);
    });
  });

  describe("given a global budget tighter than the project's share", () => {
    /** @scenario "The global budget limits the default when it is tighter" */
    it("answers the global share", () => {
      expect(
        dynamicRunConcurrency({
          projectActiveRuns: 0,
          globalActiveRuns: 2,
          projectBudget: 20,
          globalBudget: 30,
        }),
      ).toBe(10);
    });
  });

  describe("given a global budget looser than the project's share", () => {
    it("answers the project share", () => {
      expect(
        dynamicRunConcurrency({
          projectActiveRuns: 1,
          globalActiveRuns: 0,
          projectBudget: 20,
          globalBudget: 400,
        }),
      ).toBe(10);
    });
  });
});
