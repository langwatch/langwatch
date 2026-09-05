import { describe, expect, it } from "vitest";
import { EvaluationAnalyticsFoldProjection } from "../projections/evaluation-analytics-fold.projection";
import { EvaluationAnalyticsStore } from "../stores/eventing/evaluation-attributes.store";

/**
 * The evaluation half of the `trustAbsentMiss` store pairing. A `get()`-only
 * store can never answer `undecodable` — the executor stamps its nulls
 * `absent` — so a trusted fold that keeps `refoldOnStoreMiss` alongside one
 * would carry dead config that reads like a safety net.
 */
describe("evaluationAnalytics fold projection", () => {
  const fold = EvaluationAnalyticsFoldProjection.create({
    store: { store: async () => {}, get: async () => null },
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
