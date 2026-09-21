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
        activeQuery: "model:gpt-4o",
        lensId: "conversations",
        timeRange: RANGE,
        known: { evaluators: ["ragas/faithfulness"], events: ["thumbs_up_down"] },
      });

      expect(context).toContain("Typed sentence: annoyed users");
      expect(context).toContain("Lens: conversations. Time window: 24 hours.");
      expect(context).toContain("Typed alongside it as filters: status:error");
      expect(context).toContain("Search applied before this one: model:gpt-4o");
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
  });
});
