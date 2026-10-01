/**
 * The decision table with a classifier that answers: the four routes, the
 * merge of explicit terms, and what each falls back to.
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it, vi } from "vitest";

import {
  TraceSearchRouterService,
  type TraceSearchRouterDeps,
} from "../trace-search-router.service.ts";
import {
  answering,
  deps,
  input,
  NoModel,
  ProviderDisabled,
  ProviderError,
  RANGE,
} from "./trace-search-router.harness.ts";

const router = (deps: TraceSearchRouterDeps) => TraceSearchRouterService.create(deps);

describe("given a text with only field:value terms", () => {
  describe("when routed", () => {
    it("answers a filter as typed without asking anyone", async () => {
      const classifier = answering("langy");
      const d = deps({ classifier });

      const result = await router(d).route(input({ text: "status:error AND model:gpt-5-mini" }));

      expect(result).toEqual({
        kind: "filter",
        query: "status:error AND model:gpt-5-mini",
        decidedBy: "fallback",
      });
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });
});

describe("given the classifier is configured", () => {
  describe("when it answers filter", () => {
    /** @scenario "A sentence the filter language can express becomes chips" */
    it("builds the filter with the composer's builder and merges the explicit terms", async () => {
      const d = deps({ classifier: answering("filter") });

      const result = await router(d).route(input({ text: "errors from gpt-4 service:checkout" }));

      expect(result).toEqual({
        kind: "filter",
        query: "service:checkout AND status:error",
        decidedBy: "classifier",
      });
      expect(d.buildFilter).toHaveBeenCalledWith({
        projectId: "project-1",
        prompt: "errors from gpt-4",
        timeRange: RANGE,
      });
      expect(d.recordDecision).toHaveBeenCalledWith({ route: "filter", decidedBy: "classifier" });
    });

    /** @scenario "A filter the model could not write becomes a phrase search" */
    it("falls through to the phrase when the model answers an empty query", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => ({
          ok: true as const,
          kind: "apply_query" as const,
          query: "",
        })),
      });

      const result = await router(d).route(input());

      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        fellBackFrom: "filter",
      });
    });

    it("falls through to the phrase when the builder throws, flagging a missing model", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new NoModel();
        }),
      });

      const result = await router(d).route(input());

      expect(result).toMatchObject({
        kind: "free_text",
        fellBackFrom: "filter",
        modelTrouble: "no_model",
      });
    });
  });

  describe("when it answers filter and the model's provider is disabled", () => {
    /** @scenario "A classified route that finds the provider disabled says a model is unavailable" */
    it("searches the phrase and says a model is unavailable", async () => {
      const d = deps({
        classifier: answering("filter"),
        buildFilter: vi.fn(async () => {
          throw new ProviderDisabled();
        }),
      });

      const result = await router(d).route(input({ text: "failing calls" }));

      expect(result).toEqual({
        kind: "free_text",
        query: '"failing calls"',
        decidedBy: "fallback",
        fellBackFrom: "filter",
        modelTrouble: "no_model",
      });
    });
  });

  describe("when it answers instant_eval", () => {
    /** @scenario "A sentence that needs a judgement becomes an Instant Eval question" */
    it("returns the judge question, the target from the lens and the phrase fallback", async () => {
      const d = deps({ classifier: answering("instant_eval") });

      const result = await router(d).route(
        input({ text: "annoyed users status:error", lensId: "conversations" }),
      );

      expect(result).toEqual({
        kind: "instant_eval",
        question: {
          instructions: "Does the user sound annoyed?",
          criteria: ["Complains or repeats", "Stays neutral"],
        },
        target: "threads",
        otherQuery: "status:error",
        fallbackQuery: 'status:error AND "annoyed users"',
        decidedBy: "classifier",
      });
      expect(d.buildQuestion).toHaveBeenCalledWith({
        projectId: "project-1",
        text: "annoyed users",
        target: "threads",
        known: { evaluators: ["ragas/faithfulness"], events: ["thumbs_up_down"] },
      });
    });

    it("judges traces on every lens but Conversations", async () => {
      const d = deps({ classifier: answering("instant_eval") });

      const result = await router(d).route(input({ lensId: "all-traces" }));

      expect(result).toMatchObject({ kind: "instant_eval", target: "traces" });
    });

    /** @scenario "A judge question no model could write is judged as typed" */
    it("judges the sentence as typed when the question cannot be written", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        buildQuestion: vi.fn(async () => {
          throw new ProviderError();
        }),
      });
      const result = await router(d).route(input({ text: "frustrated users status:error" }));
      expect(result).toEqual({
        kind: "instant_eval",
        question: { instructions: "frustrated users" },
        target: "traces",
        otherQuery: "status:error",
        fallbackQuery: 'status:error AND "frustrated users"',
        decidedBy: "fallback",
        modelTrouble: "model_failed",
        modelErrorCode: "ai_query_provider_error",
      });
      expect(d.recordDecision).toHaveBeenCalledWith({
        route: "instant_eval",
        decidedBy: "fallback",
      });
    });

    /** @scenario "A project with no model still judges the sentence" */
    it("names the missing model when there is none to write the question", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        buildQuestion: vi.fn(async () => {
          throw new NoModel();
        }),
      });
      const result = await router(d).route(input({ text: "frustrated users" }));
      expect(result).toMatchObject({
        kind: "instant_eval",
        question: { instructions: "frustrated users" },
        modelTrouble: "no_model",
      });
    });

    /** @scenario "An existing evaluator answers the judgement as a filter" */
    it("returns a filter with the reason when an existing evaluator answers it", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        buildQuestion: vi.fn(async () => ({
          kind: "filter" as const,
          query: "evaluator:ragas/faithfulness AND evaluatorVerdict:fail",
          reason: "The faithfulness evaluator already flags these.",
        })),
      });

      const result = await router(d).route(input({ text: "hallucinated answers" }));

      expect(result).toEqual({
        kind: "filter",
        query: "evaluator:ragas/faithfulness AND evaluatorVerdict:fail",
        explanation: "The faithfulness evaluator already flags these.",
        decidedBy: "classifier",
      });
    });
  });

  describe("when it answers free_text", () => {
    /** @scenario "A literal phrase is searched as one phrase" */
    it("quotes the sentence and merges the explicit terms", async () => {
      const d = deps({ classifier: answering("free_text") });

      const result = await router(d).route(
        input({ text: "cannot connect to database service:api" }),
      );

      expect(result).toEqual({
        kind: "free_text",
        query: 'service:api AND "cannot connect to database"',
        decidedBy: "classifier",
      });
      expect(d.buildFilter).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });

  describe("when it answers langy", () => {
    /** @scenario "A question for the assistant goes to Langy with the view attached" */
    it("hands the whole typed text over as the question", async () => {
      const d = deps({ classifier: answering("langy") });

      const result = await router(d).route(input({ text: "why did errors spike this morning" }));

      expect(result).toEqual({
        kind: "langy",
        question: "why did errors spike this morning",
        decidedBy: "classifier",
      });
    });

    it("never offers the Langy option when Langy is not available", async () => {
      const classifier = answering("free_text");

      await router(deps({ classifier })).route(input({ isLangyAvailable: false }));

      const question = classifier.classify.mock.calls[0]?.[0]?.questions[0];
      expect(question?.kind).toBe("category");
      expect(question?.options.map((option) => option.name)).toEqual([
        "filter",
        "instant_eval",
        "free_text",
      ]);
    });
  });

  describe("when Instant Evals are not released for the project", () => {
    /** @scenario "With Instant Evals not released for the project the router does not offer the judgement route" */
    it("asks the classifier without the instant_eval option", async () => {
      const classifier = answering("free_text");

      await router(deps({ classifier, isInstantEvalReleased: vi.fn(async () => false) })).route(
        input(),
      );

      const question = classifier.classify.mock.calls[0]?.[0]?.questions[0];
      expect(question?.options.map((option) => option.name)).toEqual([
        "filter",
        "free_text",
        "langy",
      ]);
    });

    it("searches a judgement answer from the classifier as a filter, never as an Instant Eval", async () => {
      const d = deps({
        classifier: answering("instant_eval"),
        isInstantEvalReleased: vi.fn(async () => false),
      });

      const result = await router(d).route(input());

      expect(result).toEqual({ kind: "filter", query: "status:error", decidedBy: "classifier" });
      expect(d.buildQuestion).not.toHaveBeenCalled();
    });

    it("tells the model the route is closed and searches a judgement answer as the phrase", async () => {
      const d = deps({
        isInstantEvalReleased: vi.fn(async () => false),
        routeWithModel: vi.fn(async () => ({
          route: "instant_eval" as const,
          instructions: "Is the user annoyed?",
          criteria: ["yes", "no"] as [string, string],
        })),
      });

      const result = await router(d).route(input());

      expect(d.routeWithModel).toHaveBeenCalledWith(
        expect.objectContaining({ isInstantEvalAvailable: false }),
      );
      // The phrase is what the model settles on once the closed route is off
      // the table, so it is still the model's decision. Production never even
      // reaches this guard: the decision reader downgrades a judgement answer
      // to `free_text` before the router sees it.
      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "model",
      });
    });

    it("routes without the judgement route when the release cannot be read", async () => {
      const classifier = answering("free_text");

      await router(
        deps({
          classifier,
          isInstantEvalReleased: vi.fn(async () => {
            throw new Error("flags down");
          }),
        }),
      ).route(input());

      const question = classifier.classify.mock.calls[0]?.[0]?.questions[0];
      expect(question?.options.map((option) => option.name)).not.toContain("instant_eval");
    });
  });

  describe("when it skips or fails", () => {
    it("lets the model decide instead", async () => {
      const d = deps({
        classifier: answering(null),
        routeWithModel: vi.fn(async () => ({ route: "filter" as const, query: "status:error" })),
      });

      const result = await router(d).route(input());

      expect(result).toEqual({ kind: "filter", query: "status:error", decidedBy: "model" });
    });

    it("survives a classifier that throws", async () => {
      const d = deps({
        classifier: {
          classify: vi.fn(async () => {
            throw new Error("socket hang up");
          }),
        },
      });

      const result = await router(d).route(input());

      expect(result).toMatchObject({ kind: "free_text", decidedBy: "model" });
    });
  });
});
