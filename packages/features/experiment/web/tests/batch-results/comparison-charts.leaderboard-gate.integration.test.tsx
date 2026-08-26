import "@testing-library/jest-dom/vitest";

// @vitest-environment jsdom
/**
 * The two gates that decide whether the Bradley-Terry leaderboard (#5103)
 * appears at all — the per-organization rollout flag, and the 3+ variant
 * product rule.
 *
 * Both are asserted on the CHART and on the METRICS MENU together. Gating one
 * without the other is the failure mode worth a test: a hidden chart behind a
 * live menu entry is a switch that turns nothing on, and a live chart under a
 * hidden entry cannot be turned off.
 *
 * @see specs/experiments/comparison-leaderboard.feature
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComparisonCharts } from "../../src/batch-results/comparison-charts";
import type { BatchComparisonColumn, ComparisonRunData } from "@langwatch/experiment-web";

const EVALUATOR_ID = "comparison-1";

const runWith = (variantIds: string[]): ComparisonRunData => ({
  runId: "run-1",
  runName: "Run 1",
  color: "#3182ce",
  isLoading: false,
  data: {
    runId: "run-1",
    experimentId: "exp-1",
    projectId: "project-1",
    createdAt: Date.now(),
    datasetColumns: [{ name: "input", hasImages: false }],
    targetColumns: variantIds.map((id, i) => ({
      id,
      name: `Variant ${i + 1}`,
      type: "prompt" as const,
      outputFields: ["output"],
      metadata: {},
    })),
    evaluatorIds: [],
    evaluatorNames: {},
    rows: [
      {
        index: 0,
        datasetEntry: { input: "test" },
        targets: Object.fromEntries(
          variantIds.map((id) => [
            id,
            {
              targetId: id,
              output: { output: "response" },
              cost: 0.001,
              duration: 500,
              error: null,
              traceId: null,
              evaluatorResults: [],
            },
          ]),
        ),
      },
    ],
  },
});

/** A comparison the judge resolved in `variantIds[0]`'s favour on every row. */
const comparisonColumn = (variantIds: string[]): BatchComparisonColumn => ({
  evaluatorId: EVALUATOR_ID,
  name: "Comparison",
  variants: variantIds.map((id, i) => ({ id, name: `Variant ${i + 1}` })),
  verdictsByRow: Object.fromEntries(
    Array.from({ length: 6 }, (_, rowIndex) => [
      rowIndex,
      {
        rowIndex,
        winnerId: variantIds[0]!,
        candidateIds: variantIds,
        reasoning: "first one read better",
      },
    ]),
  ),
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const renderCharts = (variantIds: string[], showComparisonLeaderboard: boolean) => {
  const column = comparisonColumn(variantIds);
  render(
    <ComparisonCharts
      comparisonData={[runWith(variantIds)]}
      isVisible={true}
      comparisonColumns={[column]}
      comparisonRows={runWith(variantIds).data!.rows}
      showComparisonLeaderboard={showComparisonLeaderboard}
    />,
    { wrapper: Wrapper },
  );
};

const openMetricsMenu = async () => {
  const user = userEvent.setup();
  await user.click(screen.getByTestId("metrics-selector-button"));
  return screen.getByTestId("metrics-dropdown");
};

const THREE_VARIANTS = ["target-1", "target-2", "target-3"];
const TWO_VARIANTS = ["target-1", "target-2"];

describe("the comparison leaderboard's visibility gates", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an organization the rollout has not reached", () => {
    /** @scenario "An organization without the leaderboard sees no trace of it" */
    it("renders no leaderboard chart and offers no way to switch one on", async () => {
      renderCharts(THREE_VARIANTS, false);

      expect(
        screen.queryByTestId(`chart-leaderboard-${EVALUATOR_ID}`),
      ).not.toBeInTheDocument();

      const menu = await openMetricsMenu();
      expect(
        within(menu).queryByText("Comparison (Leaderboard)"),
      ).not.toBeInTheDocument();
      // The win-rate chart is a different feature and is not gated with it.
      expect(within(menu).getByText("Comparison (Win Rate)")).toBeInTheDocument();
    });
  });

  describe("given an organization that has the leaderboard", () => {
    /** @scenario "The leaderboard chart appears once there are enough variants to rank" */
    it("renders it beside the win-rate chart at three variants", async () => {
      renderCharts(THREE_VARIANTS, true);

      expect(screen.getByTestId(`chart-leaderboard-${EVALUATOR_ID}`)).toBeInTheDocument();
      expect(screen.getByTestId(`chart-comparison-${EVALUATOR_ID}`)).toBeInTheDocument();

      const menu = await openMetricsMenu();
      expect(within(menu).getByText("Comparison (Leaderboard)")).toBeInTheDocument();
    });

    it("opens the leaderboard through the supplied action", async () => {
      const user = userEvent.setup();
      const column = comparisonColumn(THREE_VARIANTS);
      const comparison = runWith(THREE_VARIANTS);
      const comparisonRows = comparison.data?.rows ?? [];
      const onOpenLeaderboard = vi.fn();

      render(
        <ComparisonCharts
          comparisonData={[comparison]}
          isVisible={true}
          comparisonColumns={[column]}
          comparisonRows={comparisonRows}
          showComparisonLeaderboard={true}
          onOpenLeaderboard={onOpenLeaderboard}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByRole("button", { name: "Expand leaderboard" }));

      expect(onOpenLeaderboard).toHaveBeenCalledWith({
        evaluatorId: EVALUATOR_ID,
        column,
        rows: comparisonRows,
        targetColors: {
          "target-1": "#3b82f6",
          "target-2": "#dd6b20",
          "target-3": "#38a169",
        },
        modelByTargetId: {
          "target-1": null,
          "target-2": null,
          "target-3": null,
        },
        judgeModel: null,
      });
    });

    /** @scenario "Two variants is a plain win-rate story, not a leaderboard" */
    it("leaves it out at two variants, where win rate already tells the story", async () => {
      renderCharts(TWO_VARIANTS, true);

      expect(
        screen.queryByTestId(`chart-leaderboard-${EVALUATOR_ID}`),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(`chart-comparison-${EVALUATOR_ID}`)).toBeInTheDocument();

      const menu = await openMetricsMenu();
      expect(
        within(menu).queryByText("Comparison (Leaderboard)"),
      ).not.toBeInTheDocument();
    });
  });
});
