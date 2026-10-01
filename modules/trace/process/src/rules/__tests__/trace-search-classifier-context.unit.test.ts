/**
 * What the classifier is asked and what it reads the sentence next to.
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it } from "vitest";

import { RANGE } from "../../services/__tests__/trace-search-router.harness.ts";
import { buildRouteContext, buildRouteQuestion } from "../trace-search-classifier-context.rules.ts";

describe("given the classifier's input", () => {
  describe("when the context is built", () => {
    it("carries the sentence, the lens, the window, the fields and the known signals", () => {
      const context = buildRouteContext({
        sentence: "annoyed users",
        explicitQuery: "status:error",
        activeQuery: "model:gpt-5-mini",
        lensId: "conversations",
        timeRange: RANGE,
        known: { evaluators: ["ragas/faithfulness"], events: ["thumbs_up_down"] },
      });

      expect(context).toContain("Typed sentence: annoyed users");
      expect(context).toContain("Lens: conversations. Time window: 24 hours.");
      expect(context).toContain("Typed alongside it as filters: status:error");
      expect(context).toContain("Search applied before this one: model:gpt-5-mini");
      expect(context).toContain("status, model, service");
      expect(context).toContain("ragas/faithfulness");
      expect(context).toContain("thumbs_up_down");
    });

    it("asks one category question with the four routes", () => {
      const question = buildRouteQuestion({ isLangyAvailable: true });

      expect(question.options.map((option) => option.name)).toEqual([
        "filter",
        "instant_eval",
        "free_text",
        "langy",
      ]);
    });

    /** @scenario "A sentence about what the agent did is offered to the classifier as a judgement" */
    it("offers what the agent did as a judgement, not as a phrase", () => {
      const options = new Map(
        buildRouteQuestion({ isLangyAvailable: true }).options.map((option) => [
          option.name,
          option.description,
        ]),
      );

      expect(options.get("instant_eval")).toContain("what the agent did");
      expect(options.get("instant_eval")).toContain("a tool called with a wrong value");
      expect(options.get("free_text")).toContain(
        "A description of something that happened is not a literal string.",
      );
    });
  });
});
