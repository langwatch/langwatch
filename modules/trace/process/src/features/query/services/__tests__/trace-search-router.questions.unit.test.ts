/**
 * A question typed into the search bar is judged, never matched as a phrase.
 * Spec: specs/traces-v2/search.feature
 */
import { describe, expect, it, vi } from "vitest";

import { TraceSearchRouterService } from "../trace-search-router.service.ts";
import { deps, input, NoModel } from "./trace-search-router.harness.ts";

const QUESTION = "Was the customer frustrated?";

describe("given a question and Instant Evals available", () => {
  describe("when the classifier answers free_text", () => {
    /** @scenario "A question the classifier or the model calls a phrase is judged instead" */
    it("routes it to an Instant Eval the model rewrites", async () => {
      const d = deps();
      const result = await TraceSearchRouterService.create(d).route(
        input({ text: QUESTION, classified: "free_text", isInstantEvalAvailable: true }),
      );

      expect(result).toMatchObject({
        kind: "instant_eval",
        question: { instructions: "Does the user sound annoyed?" },
        target: "traces",
        fallbackQuery: `"${QUESTION}"`,
      });
      expect(d.buildQuestion).toHaveBeenCalledWith(expect.objectContaining({ text: QUESTION }));
    });

    it("still searches a sentence that is not a question as a phrase", async () => {
      const result = await TraceSearchRouterService.create(deps()).route(
        input({
          text: "cannot connect to database",
          classified: "free_text",
          isInstantEvalAvailable: true,
        }),
      );

      expect(result).toMatchObject({ kind: "free_text", query: '"cannot connect to database"' });
    });
  });

  describe("when the question builder answers a blank filter", () => {
    it("judges the question as typed instead of searching nothing", async () => {
      const d = deps({
        buildQuestion: vi.fn(async () => ({ kind: "filter" as const, query: "   ", reason: "" })),
      });
      const result = await TraceSearchRouterService.create(d).route(
        input({ text: QUESTION, classified: "free_text", isInstantEvalAvailable: true }),
      );

      expect(result).toMatchObject({
        kind: "instant_eval",
        question: { instructions: QUESTION },
        decidedBy: "fallback",
      });
    });
  });

  describe("when the model routes it as free_text without a classifier", () => {
    it("routes it to an Instant Eval on the Conversations lens as threads", async () => {
      const d = deps({ routeWithModel: vi.fn(async () => ({ route: "free_text" as const })) });
      const result = await TraceSearchRouterService.create(d).route(
        input({ text: QUESTION, isInstantEvalAvailable: true, lensId: "conversations" }),
      );

      expect(result).toMatchObject({ kind: "instant_eval", target: "threads" });
    });
  });

  describe("when no model can route it", () => {
    /** @scenario "A question no model could route is judged as typed" */
    it("judges the question as typed and says the model is missing", async () => {
      const d = deps({
        routeWithModel: vi.fn(async () => {
          throw new NoModel();
        }),
      });
      const result = await TraceSearchRouterService.create(d).route(
        input({ text: QUESTION, isInstantEvalAvailable: true }),
      );

      expect(result).toMatchObject({
        kind: "instant_eval",
        question: { instructions: QUESTION },
        decidedBy: "fallback",
        modelTrouble: "no_model",
      });
    });
  });
});

describe("given a question and Instant Evals unavailable", () => {
  describe("when the classifier answers free_text", () => {
    /** @scenario "A question stays a phrase search while Instant Evals are unavailable" */
    it("searches it as one phrase", async () => {
      const result = await TraceSearchRouterService.create(deps()).route(
        input({ text: QUESTION, classified: "free_text", isInstantEvalAvailable: false }),
      );

      expect(result).toMatchObject({ kind: "free_text", query: `"${QUESTION}"` });
    });
  });
});
