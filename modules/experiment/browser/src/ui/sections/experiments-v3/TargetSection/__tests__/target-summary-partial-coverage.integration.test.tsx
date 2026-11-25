// @vitest-environment jsdom
/**
 * A stopped run's column can have results for only part of the dataset.
 */
import "@testing-library/jest-dom/vitest";
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { TargetAggregate } from "@langwatch/experiment-contract";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TargetSummary } from "../target-summary.tsx";

vi.mock("../../../../../behavior/experiments-v3/use-evaluator-name.ts", () => ({
  useEvaluatorNames: () => new Map<string, string>(),
}));

afterEach(() => cleanup());

const createAggregate = (overrides: Partial<TargetAggregate> = {}): TargetAggregate => ({
  targetId: "target-1",
  completedRows: 0,
  totalRows: 10,
  errorRows: 0,
  evaluators: [],
  overallPassRate: null,
  overallAverageScore: null,
  averageCost: null,
  totalCost: null,
  averageLatency: null,
  totalDuration: null,
  latencyStats: null,
  costStats: null,
  ...overrides,
});

describe("TargetSummary", () => {
  describe("given a column whose run has stopped", () => {
    describe("when it has results for only some of the dataset", () => {
      /** @scenario "A score over part of the dataset says how much it covers" */
      it("draws the row count beside the score", () => {
        const aggregates = createAggregate({
          completedRows: 30,
          totalRows: 40,
          overallPassRate: 93,
        });

        renderWithDesignSystem(<TargetSummary aggregates={aggregates} evaluators={[]} />);

        // The score alone reads as this column's result. The count is what
        // stops it being compared against a column that answered every row.
        expect(screen.getByText("30/40")).toBeInTheDocument();
      });
    });

    describe("when it has results for the whole dataset", () => {
      /** @scenario "A score over the whole dataset stands on its own" */
      it("draws the score with no row count beside it", () => {
        const aggregates = createAggregate({
          completedRows: 40,
          totalRows: 40,
          overallPassRate: 92,
        });

        renderWithDesignSystem(<TargetSummary aggregates={aggregates} evaluators={[]} />);

        expect(screen.queryByText("40/40")).not.toBeInTheDocument();
      });
    });
  });
});
