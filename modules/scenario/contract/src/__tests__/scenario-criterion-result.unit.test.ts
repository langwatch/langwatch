import { describe, expect, it } from "vitest";

import {
  resolveCriterionResults,
  resolveInconclusiveCriteria,
} from "../scenario-criterion-result.ts";

describe("resolveCriterionResults", () => {
  describe("when the stored verdicts cover only some listed criteria", () => {
    /** @scenario "A criterion the per-criterion verdicts miss is derived from the lists" */
    it("keeps the stored verdicts first and derives the missing ones", () => {
      const stored = {
        criterion: "stays polite",
        requirement: "The agent stays polite",
        status: "passed" as const,
        reasoning: "Every reply was courteous.",
      };

      const results = resolveCriterionResults({
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
  });
});

describe("resolveInconclusiveCriteria", () => {
  describe("when the list is sent", () => {
    it("keeps the list", () => {
      expect(
        resolveInconclusiveCriteria({
          inconclusiveCriteria: ["a"],
          criteria: [{ criterion: "b", status: "inconclusive", reasoning: "" }],
        }),
      ).toEqual(["a"]);
    });
  });

  describe("when only the verdicts are sent", () => {
    it("takes the criteria they mark inconclusive", () => {
      expect(
        resolveInconclusiveCriteria({
          criteria: [
            { criterion: "a", status: "passed", reasoning: "" },
            { criterion: "b", status: "inconclusive", reasoning: "" },
          ],
        }),
      ).toEqual(["b"]);
    });
  });
});
