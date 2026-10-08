import { describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceAnalyticsFoldProjection } from "../trace-derived.projection.ts";
import { TraceAnalyticsStore } from "../trace-derived.store.ts";
import { TraceSummaryFoldProjection } from "../trace-summary.projection.ts";
import { TraceSummaryStore } from "../trace-summary.store.ts";
import { createTestRuntime } from "./trace-summary-test.fixtures.ts";

/** A structural contract behind trustAbsentMiss: a get()-only store can never
 * answer undecodable since the executor stamps its nulls absent. The pairing is
 * only visible here; folds are wrapped in a cache by the time they reach router. */

const deps = {
  store: { store: async () => {}, get: async () => ({ kind: "empty" as const }) },
  traceCanonicalisation: TraceCanonicalisationService.create(),
  runtime: createTestRuntime(),
};

const FOLDS = [
  {
    name: "traceSummary",
    projection: TraceSummaryFoldProjection.create(deps),
    // TraceSummaryStore is get()-only — consistent, because this fold declares
    // no refoldOnStoreMiss for a miss discriminator to feed.
    storeClass: TraceSummaryStore,
  },
  {
    name: "traceAnalytics",
    projection: TraceAnalyticsFoldProjection.create(deps),
    storeClass: TraceAnalyticsStore,
  },
];

describe("trace fold projections", () => {
  describe("given a fold declares trustAbsentMiss", () => {
    const optionsOf = (fold: (typeof FOLDS)[number]) =>
      fold.projection.options as {
        trustAbsentMiss?: boolean;
        refoldOnStoreMiss?: boolean;
      };
    const trusted = FOLDS.filter((fold) => optionsOf(fold).trustAbsentMiss === true);

    it("covers the folds this contract was written for", () => {
      expect(trusted.map((fold) => fold.name).toSorted()).toEqual([
        "traceAnalytics",
        "traceSummary",
      ]);
    });

    /** @scenario trusting absence must not orphan the undecodable net */
    it("pairs refoldOnStoreMiss with a store that can distinguish undecodable", () => {
      for (const fold of trusted) {
        if (optionsOf(fold).refoldOnStoreMiss !== true) continue;
        expect(
          typeof (fold.storeClass.prototype as { getWithApplied?: unknown }).getWithApplied,
          `${fold.name} keeps refoldOnStoreMiss but its store cannot report an undecodable miss`,
        ).toBe("function");
      }
    });
  });
});
