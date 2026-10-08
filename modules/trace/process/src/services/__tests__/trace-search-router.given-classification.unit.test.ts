/**
 * The router given the classification and availability Instant Eval's door
 * answered the browser: it routes on them and asks nobody itself.
 * Spec: specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it, vi } from "vitest";

import { TraceSearchRouterService } from "../trace-search-router.service.ts";
import { answering, deps, input } from "./trace-search-router.harness.ts";

describe("given the browser passes Instant Eval's classification", () => {
  describe("when it answers instant_eval with Instant Evals available", () => {
    /** @scenario "A sentence classified as a judgement routes to Instant Eval" */
    it("routes to an Instant Eval decided by the classifier without asking Instant Eval", async () => {
      const classifier = answering("free_text");
      const isInstantEvalReleased = vi.fn(async () => false);
      const d = deps({ classifier, isInstantEvalReleased });

      const result = await TraceSearchRouterService.create(d).route(
        input({ classified: "instant_eval", isInstantEvalAvailable: true }),
      );

      expect(result).toMatchObject({ kind: "instant_eval", decidedBy: "classifier" });
      expect(classifier.classify).not.toHaveBeenCalled();
      expect(isInstantEvalReleased).not.toHaveBeenCalled();
    });
  });

  describe("when it answers instant_eval with Instant Evals unavailable", () => {
    /** @scenario "A sentence routes to the plain search when Instant Evals are unavailable" */
    it("searches a filter, never an Instant Eval", async () => {
      const isInstantEvalReleased = vi.fn(async () => true);
      const d = deps({ isInstantEvalReleased });

      const result = await TraceSearchRouterService.create(d).route(
        input({ classified: "instant_eval", isInstantEvalAvailable: false }),
      );

      expect(result).toEqual({ kind: "filter", query: "status:error", decidedBy: "classifier" });
      expect(d.buildQuestion).not.toHaveBeenCalled();
      expect(isInstantEvalReleased).not.toHaveBeenCalled();
    });
  });
});
