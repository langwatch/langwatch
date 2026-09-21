// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * What the pipeline mounts, given which dependencies.
 *
 * The drift check and the summary it compares against are two separate
 * optional deps, so a configuration can hold either one alone. Only one of
 * those combinations is safe to arm, and this file is what says so — the
 * integration suite proves the behaviour of a mounted check, never the
 * decision to mount it.
 *
 * Spec: specs/governance/cost-rollup-watch.feature
 * Decision: ADR-128.
 */
import { COST_ROLLUP_WATCH_PROCESS_NAME } from "@ee/governance/process-manager/costRollupWatch.process";
import type { GovernanceCostRollupState } from "@ee/governance/projections/governanceCostRollup.foldProjection";
import type { CostRollupComparatorDayComparer } from "@ee/governance/services/costRollupComparator.service";
import { describe, expect, it } from "vitest";
import type { FoldProjectionStore } from "~/server/event-sourcing/projections/foldProjection.types";

import { createPulledUsageProcessingPipeline } from "../pipeline";

/**
 * Neither stub is ever called: mounting is decided by the presence of the
 * dep, not by anything it does.
 */
const comparator = {
  compareDay: async ({ day, costSource }) => ({
    day,
    costSource,
    mismatches: [],
    lagMs: 0,
    behind: [],
  }),
} satisfies CostRollupComparatorDayComparer;
const store = {} as FoldProjectionStore<GovernanceCostRollupState>;

function mountsWatch(
  deps: Parameters<typeof createPulledUsageProcessingPipeline>[0],
) {
  return createPulledUsageProcessingPipeline(deps).processManagers.has(
    COST_ROLLUP_WATCH_PROCESS_NAME,
  );
}

describe("mounting the cost-rollup watch", () => {
  describe("when both the summary store and the comparer are configured", () => {
    it("mounts the check", () => {
      expect(
        mountsWatch({
          costRollupStore: store,
          costRollupComparator: comparator,
        }),
      ).toBe(true);
    });
  });

  describe("when a comparer is configured but no summary store is", () => {
    /** @scenario A deployment that can compare but holds no summary mounts no check */
    it("mounts no check", () => {
      expect(mountsWatch({ costRollupComparator: comparator })).toBe(false);
    });
  });

  describe("when a summary store is configured but no comparer is", () => {
    it("mounts no check", () => {
      expect(mountsWatch({ costRollupStore: store })).toBe(false);
    });
  });
});
