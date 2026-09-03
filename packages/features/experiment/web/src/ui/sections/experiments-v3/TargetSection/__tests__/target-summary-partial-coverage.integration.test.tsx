// @vitest-environment jsdom
/**
 * A stopped run's column can have results for only part of the dataset. The
 * score alone would read as the column's final answer, so the coverage
 * count has to ride along beside it whenever the run stopped short — and
 * has to disappear once the run actually covered every row, so a complete
 * column isn't second-guessed by a count nobody asked for.
 */
import "@testing-library/jest-dom/vitest";

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TargetAggregate } from "../../../../../model/experiments-v3/compute-aggregates";
import { TargetSummary } from "../target-summary";

vi.mock("../../../../../behavior/experiments-v3/use-evaluator-name", () => ({
  useEvaluatorNames: () => new Map<string, string>(),
}));

afterEach(() => cleanup());

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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

        render(<TargetSummary aggregates={aggregates} evaluators={[]} />, {
          wrapper: Wrapper,
        });

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

        render(<TargetSummary aggregates={aggregates} evaluators={[]} />, {
          wrapper: Wrapper,
        });

        expect(screen.queryByText("40/40")).not.toBeInTheDocument();
      });
    });
  });
});
