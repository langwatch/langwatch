import { describe, expect, it } from "vitest";

import { EvaluationAnalyticsFoldProjection } from "../eventing/evaluation-analytics-fold.projection.ts";
import { EvaluationAnalyticsStore } from "../eventing/evaluation-attributes.store.ts";

/**
 * The evaluation half of the `trustAbsentMiss` store pairing. A `get()`-only
 * store can never answer `undecodable` (nulls stamp `absent`), so a trusted
 * fold keeping `refoldOnStoreMiss` alongside one carries dead config.
 */
describe("evaluationAnalytics fold projection", () => {
  const fold = EvaluationAnalyticsFoldProjection.create({
    store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  });

  it("is one of the folds that trusts an absent read", () => {
    expect(fold.options?.trustAbsentMiss).toBe(true);
  });

  /** @scenario trusting absence must not orphan the undecodable net */
  it("pairs refoldOnStoreMiss with a store that can distinguish undecodable", () => {
    if (fold.options?.refoldOnStoreMiss !== true) return;
    expect(
      typeof (EvaluationAnalyticsStore.prototype as { getWithApplied?: unknown }).getWithApplied,
    ).toBe("function");
  });
});
