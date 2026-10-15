/**
 * The router given the classification and availability Instant Eval's door
 * answered the browser: it routes on them and asks nobody itself.
 * Spec: specs/traces-v2/instant-eval-search.feature
 */
import { describe, expect, it } from "vitest";

import { TraceSearchRouterService } from "../trace-search-router.service.ts";
import { deps, input } from "./trace-search-router.harness.ts";

describe("given the browser passes Instant Eval's classification", () => {
  describe("when it answers instant_eval with Instant Evals available", () => {
    /** @scenario "A sentence classified as a judgement routes to Instant Eval" */
    it("routes to an Instant Eval decided by the classifier without asking the model to route", async () => {
      const d = deps();

      const result = await TraceSearchRouterService.create(d).route(
        input({ classified: "instant_eval", isInstantEvalAvailable: true }),
      );

      expect(result).toMatchObject({ kind: "instant_eval", decidedBy: "classifier" });
      expect(d.routeWithModel).not.toHaveBeenCalled();
    });
  });

  describe("when it answers instant_eval with Instant Evals unavailable", () => {
    /** @scenario "A sentence routes to the plain search when Instant Evals are unavailable" */
    it("searches a filter, never an Instant Eval", async () => {
      const d = deps();

      const result = await TraceSearchRouterService.create(d).route(
        input({ classified: "instant_eval", isInstantEvalAvailable: false }),
      );

      expect(result).toEqual({ kind: "filter", query: "status:error", decidedBy: "classifier" });
      expect(d.buildQuestion).not.toHaveBeenCalled();
    });
  });
});
