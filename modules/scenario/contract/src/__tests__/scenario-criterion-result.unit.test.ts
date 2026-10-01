import { describe, expect, it } from "vitest";

import { deriveCriteriaLists, deriveCriterionResults } from "../scenario-criterion-result.ts";

describe("deriveCriterionResults", () => {
  describe("when the stored verdicts cover only some listed criteria", () => {
    /** @scenario "A criterion the per-criterion verdicts miss is derived from the lists" */
    it("derives the missing ones with empty reasoning", () => {
      const stored = {
        criterion: "stays polite",
        requirement: "The agent stays polite",
        status: "passed" as const,
        reasoning: "Every reply was courteous.",
      };

      const results = deriveCriterionResults({
        criteria: [stored],
        metCriteria: ["stays polite", "greets the user"],
        unmetCriteria: ["opens a ticket", "names the refund window"],
        inconclusiveCriteria: ["opens a ticket"],
      });

      expect(results).toEqual([
        stored,
        { criterion: "greets the user", status: "passed", reasoning: "" },
        { criterion: "opens a ticket", status: "inconclusive", reasoning: "" },
        { criterion: "names the refund window", status: "failed", reasoning: "" },
      ]);
    });

    /** @scenario "A criterion the per-criterion verdicts miss is derived from the lists" */
    it("places a derived criterion where the lists declare it, not after the stored ones", () => {
      const greets = { criterion: "greets the user", status: "failed" as const, reasoning: "No." };
      const closes = { criterion: "closes politely", status: "passed" as const, reasoning: "Yes." };

      const results = deriveCriterionResults({
        criteria: [greets, closes],
        metCriteria: ["asks the order number", "closes politely"],
        unmetCriteria: ["greets the user"],
      });

      expect(results.map((result) => result.criterion)).toEqual([
        "greets the user",
        "asks the order number",
        "closes politely",
      ]);
    });
  });

  describe("when the stored verdicts cover every criterion", () => {
    it("keeps them in the order they were stored", () => {
      const criteria = [
        { criterion: "b", status: "failed" as const, reasoning: "" },
        { criterion: "a", status: "passed" as const, reasoning: "" },
      ];

      expect(
        deriveCriterionResults({ criteria, metCriteria: ["a"], unmetCriteria: ["b"] }),
      ).toEqual(criteria);
    });
  });
});

describe("deriveCriteriaLists", () => {
  describe("when the lists are sent", () => {
    it("keeps them", () => {
      expect(
        deriveCriteriaLists({
          metCriteria: ["a"],
          unmetCriteria: ["b"],
          inconclusiveCriteria: ["b"],
          criteria: [
            { criterion: "c", status: "passed", reasoning: "" },
            { criterion: "d", status: "inconclusive", reasoning: "" },
          ],
        }),
      ).toEqual({ metCriteria: ["a"], unmetCriteria: ["b"], inconclusiveCriteria: ["b"] });
    });
  });

  describe("when only the verdicts are sent", () => {
    /** @scenario "Met and unmet criteria are taken from the per-criterion verdicts when the lists are absent" */
    it("derives each list from the statuses", () => {
      expect(
        deriveCriteriaLists({
          criteria: [
            { criterion: "a", status: "passed", reasoning: "" },
            { criterion: "b", status: "inconclusive", reasoning: "" },
            { criterion: "c", status: "failed", reasoning: "" },
          ],
        }),
      ).toEqual({ metCriteria: ["a"], unmetCriteria: ["b", "c"], inconclusiveCriteria: ["b"] });
    });
  });
});
