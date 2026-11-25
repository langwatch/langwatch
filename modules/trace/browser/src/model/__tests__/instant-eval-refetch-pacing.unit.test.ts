/**
 * How often the Explorer reads again while a run judges: often enough that
 * matches visibly arrive, never once per counter move.
 *
 * @see specs/traces-v2/instant-eval-search.feature
 */

import { describe, expect, it } from "vitest";

import {
  dueInstantEvalRefetches,
  INSTANT_EVAL_FACETS_REFETCH_MS,
  INSTANT_EVAL_LIST_REFETCH_MS,
} from "../instant-eval-refetch-pacing.ts";

describe("given the Explorer's reads while an Instant Eval judges", () => {
  describe("when a run is active", () => {
    it("paces the list and the facets apart", () => {
      const now = 100_000;
      expect(
        dueInstantEvalRefetches({
          now,
          lastListAt: now - INSTANT_EVAL_LIST_REFETCH_MS,
          lastFacetsAt: now - 1,
          isAnyRunActive: true,
        }),
      ).toEqual({ list: true, facets: false });
      expect(
        dueInstantEvalRefetches({
          now,
          lastListAt: now - 1,
          lastFacetsAt: now - INSTANT_EVAL_FACETS_REFETCH_MS,
          isAnyRunActive: true,
        }),
      ).toEqual({ list: false, facets: true });
    });
  });

  describe("when no run is active", () => {
    it("never skips the read after the run ended", () => {
      expect(
        dueInstantEvalRefetches({
          now: 1,
          lastListAt: 1,
          lastFacetsAt: 1,
          isAnyRunActive: false,
        }),
      ).toEqual({ list: true, facets: true });
    });
  });
});
