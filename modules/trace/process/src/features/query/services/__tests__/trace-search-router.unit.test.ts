/**
 * The decision table given the classification the browser brought from
 * Instant Eval: the four routes, the merge of explicit terms, and what each
 * falls back to. Spec: specs/traces-v2/search.feature
 */
import type { RouteSearchInput, SearchRouteKind } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import {
  TraceSearchRouterService,
  type TraceSearchRouterDeps,
} from "../trace-search-router.service.ts";
import {
  deps,
  input,
  NoModel,
  PROOF,
  ProviderDisabled,
  ProviderError,
  RANGE,
} from "./trace-search-router.harness.ts";

const router = (deps: TraceSearchRouterDeps) => TraceSearchRouterService.create(deps);

/** A submit Instant Eval's door classified, with the judgement route open. */
const classifiedAs = (
  classified: SearchRouteKind,
  overrides: Partial<RouteSearchInput> = {},
): ReturnType<typeof input> => input({ classified, isInstantEvalAvailable: true, ...overrides });

describe("given a text with only field:value terms", () => {
  describe("when routed", () => {
    it("answers a filter as typed without asking anyone", async () => {
      const d = deps();

      const result = await router(d).route(
        classifiedAs("langy", { text: "status:error AND model:gpt-5-mini" }),
      );

      expect(result).toEqual({
        kind: "filter",
        query: "status:error AND model:gpt-5-mini",
        decidedBy: "fallback",
      });
      expect(d.buildFilter).not.toHaveBeenCalled();
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });
});

describe("given the browser brings Instant Eval's classification", () => {
  describe("when it answers filter", () => {
    /** @scenario "A sentence the filter language can express becomes chips" */
    it("builds the filter with the composer's builder and merges the explicit terms", async () => {
      const d = deps();

      const result = await router(d).route(
        classifiedAs("filter", { text: "errors from gpt-4 service:checkout" }),
      );

      expect(result).toEqual({
        kind: "filter",
        query: "service:checkout AND status:error",
        decidedBy: "classifier",
      });
      expect(d.buildFilter).toHaveBeenCalledWith({
        projectId: "project-1",
        authorization: PROOF,
        prompt: "errors from gpt-4",
        timeRange: RANGE,
      });
      expect(d.recordDecision).toHaveBeenCalledWith({ route: "filter", decidedBy: "classifier" });
    });

    /** @scenario "A filter the model could not write becomes a phrase search" */
    it("falls through to the phrase when the model answers an empty query", async () => {
      const d = deps({
        buildFilter: vi.fn(async () => ({
          ok: true as const,
          kind: "apply_query" as const,
          query: "",
        })),
      });

      const result = await router(d).route(classifiedAs("filter"));

      expect(result).toEqual({
        kind: "free_text",
        query: '"annoyed users"',
        decidedBy: "fallback",
        fellBackFrom: "filter",
      });
    });

    it("falls through to the phrase when the builder throws, flagging a missing model", async () => {
      const d = deps({
        buildFilter: vi.fn(async () => {
          throw new NoModel();
        }),
      });

      const result = await router(d).route(classifiedAs("filter"));

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
        buildFilter: vi.fn(async () => {
          throw new ProviderDisabled();
        }),
      });

      const result = await router(d).route(classifiedAs("filter", { text: "failing calls" }));

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
      const d = deps();

      const result = await router(d).route(
        classifiedAs("instant_eval", {
          text: "annoyed users status:error",
          lensId: "conversations",
        }),
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
      const d = deps();

      const result = await router(d).route(classifiedAs("instant_eval", { lensId: "all-traces" }));

      expect(result).toMatchObject({ kind: "instant_eval", target: "traces" });
    });

    /** @scenario "A judge question no model could write is judged as typed" */
    it("judges the sentence as typed when the question cannot be written", async () => {
      const d = deps({
        buildQuestion: vi.fn(async () => {
          throw new ProviderError();
        }),
      });
      const result = await router(d).route(
        classifiedAs("instant_eval", { text: "frustrated users status:error" }),
      );
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
        buildQuestion: vi.fn(async () => {
          throw new NoModel();
        }),
      });
      const result = await router(d).route(
        classifiedAs("instant_eval", { text: "frustrated users" }),
      );
      expect(result).toMatchObject({
        kind: "instant_eval",
        question: { instructions: "frustrated users" },
        modelTrouble: "no_model",
      });
    });

    /** @scenario "An existing evaluator answers the judgement as a filter" */
    it("returns a filter with the reason when an existing evaluator answers it", async () => {
      const d = deps({
        buildQuestion: vi.fn(async () => ({
          kind: "filter" as const,
          query: "evaluator:ragas/faithfulness AND evaluatorVerdict:fail",
          reason: "The faithfulness evaluator already flags these.",
        })),
      });

      const result = await router(d).route(
        classifiedAs("instant_eval", { text: "hallucinated answers" }),
      );

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
      const d = deps();

      const result = await router(d).route(
        classifiedAs("free_text", { text: "cannot connect to database service:api" }),
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
      const d = deps();

      const result = await router(d).route(
        classifiedAs("langy", { text: "why did errors spike this morning" }),
      );

      expect(result).toEqual({
        kind: "langy",
        question: "why did errors spike this morning",
        decidedBy: "classifier",
      });
    });
  });
});

describe("given Instant Evals are not available to the project", () => {
  describe("when the classification answers instant_eval", () => {
    /** @scenario "With Instant Evals not released for the project the router does not offer the judgement route" */
    it("searches it as a filter, never as an Instant Eval", async () => {
      const d = deps();

      const result = await router(d).route(
        input({ classified: "instant_eval", isInstantEvalAvailable: false }),
      );

      expect(result).toEqual({ kind: "filter", query: "status:error", decidedBy: "classifier" });
      expect(d.buildQuestion).not.toHaveBeenCalled();
    });
  });

  describe("when the model decides", () => {
    it("tells the model the route is closed and searches a judgement answer as the phrase", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => ({
          route: "instant_eval" as const,
          instructions: "Is the user annoyed?",
          criteria: ["yes", "no"] as [string, string],
        })),
      });

      const result = await router(d).route(input({ isInstantEvalAvailable: false }));

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
  });
});
