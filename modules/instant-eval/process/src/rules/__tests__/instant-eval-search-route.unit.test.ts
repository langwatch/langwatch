/**
 * What the routing classifier is asked and what it reads the sentence next to;
 * pinned as trace's router pinned it before the door moved here.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { InstantEvalJudgement } from "@langwatch/instant-eval-judge-contract";
import { describe, expect, it } from "vitest";

import {
  buildRouteContext,
  buildRouteQuestion,
  routeAnswerOf,
} from "../instant-eval-search-route.rules.ts";

const RANGE = { from: 0, to: 24 * 3_600_000 };

function judged(label: string): InstantEvalJudgement {
  return { verdicts: [{ questionId: "route", label }], inputTokens: 10, isTextTruncated: false };
}

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

      expect(context.split("\n")).toEqual([
        "Typed sentence: annoyed users",
        "Lens: conversations. Time window: 24 hours.",
        "Typed alongside it as filters: status:error",
        "Search applied before this one: model:gpt-5-mini",
        expect.stringMatching(/^Filter fields available: .*status, model, service/),
        "Evaluators with results on this project: ragas/faithfulness",
        "Event names on this project: thumbs_up_down",
      ]);
    });

    it("names all traces and no signals when there is no lens and nothing is known", () => {
      const context = buildRouteContext({
        sentence: "annoyed users",
        explicitQuery: "",
        activeQuery: "",
        timeRange: RANGE,
        known: { evaluators: [], events: [] },
      });

      expect(context).toContain("Lens: all traces.");
      expect(context).not.toContain("Typed alongside it");
      expect(context).not.toContain("Search applied before");
      expect(context).toContain("Evaluators with results on this project: none");
      expect(context).toContain("Event names on this project: none");
    });
  });

  describe("when the question is built", () => {
    it("asks one category question with the four routes when both are open", () => {
      const question = buildRouteQuestion({ isLangyAvailable: true, isInstantEvalAvailable: true });

      expect(question.id).toBe("route");
      expect(question.options.map((option) => option.name)).toEqual([
        "filter",
        "instant_eval",
        "free_text",
        "langy",
      ]);
    });

    it("leaves out langy and instant_eval when neither is open", () => {
      const question = buildRouteQuestion({
        isLangyAvailable: false,
        isInstantEvalAvailable: false,
      });

      expect(question.options.map((option) => option.name)).toEqual(["filter", "free_text"]);
    });

    /** @scenario "A sentence about what the agent did is offered to the classifier as a judgement" */
    it("offers what the agent did as a judgement, not as a phrase", () => {
      const options = new Map(
        buildRouteQuestion({ isLangyAvailable: true, isInstantEvalAvailable: true }).options.map(
          (option) => [option.name, option.description],
        ),
      );

      expect(options.get("instant_eval")).toContain("what the agent did");
      expect(options.get("instant_eval")).toContain("a tool called with a wrong value");
      expect(options.get("free_text")).toContain(
        "A description of something that happened is not a literal string.",
      );
    });
  });
});

describe("given the classifier's judgement", () => {
  const question = buildRouteQuestion({ isLangyAvailable: false, isInstantEvalAvailable: true });

  describe("when it names an offered option", () => {
    it("answers the route it picked", () => {
      expect(routeAnswerOf({ judgement: judged("instant_eval"), question })).toEqual({
        kind: "routed",
        route: "instant_eval",
      });
    });
  });

  describe("when it names an option it was not offered, or skipped", () => {
    it("answers unrouted", () => {
      expect(routeAnswerOf({ judgement: judged("langy"), question })).toEqual({ kind: "unrouted" });
      expect(
        routeAnswerOf({
          judgement: {
            verdicts: [],
            skippedReason: "classifier_failed",
            inputTokens: 0,
            isTextTruncated: false,
          },
          question,
        }),
      ).toEqual({ kind: "unrouted" });
    });
  });
});
