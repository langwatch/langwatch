/**
 * What the classifier is asked and what it reads the sentence next to. Both
 * are pinned here because a change to either changes every routing decision
 * the product makes.
 *
 * Spec: specs/traces-v2/search.feature ("Enter routes a sentence").
 */
import { describe, expect, it } from "vitest";
import { buildRouteContext, buildRouteQuestion } from "../classifier-context";
import { RANGE } from "./harness";

describe("given the classifier's input", () => {
  describe("when the context is built", () => {
    it("carries the sentence, the lens, the window, the fields and the known signals", () => {
      const context = buildRouteContext({
        sentence: "annoyed users",
        explicitQuery: "status:error",
        activeQuery: "model:gpt-4o",
        lensId: "conversations",
        timeRange: RANGE,
        known: {
          evaluators: ["ragas/faithfulness"],
          events: ["thumbs_up_down"],
        },
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
