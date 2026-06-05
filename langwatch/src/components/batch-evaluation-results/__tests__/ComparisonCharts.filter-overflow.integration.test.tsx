// @vitest-environment jsdom
/**
 * Regression test for issue #4631: experiment comparison filter dropdowns
 * (Group by, Metrics) get clipped by overflow:hidden ancestors in
 * BatchEvaluationResults. Fix renders each dropdown body in a <Portal> so it
 * escapes ancestor clipping.
 *
 * Strategy: assert the dropdown DOM is rendered OUTSIDE the ComparisonCharts
 * subtree (i.e., portaled). jsdom does not compute layout, so we test the
 * structural property that guarantees no clipping rather than measuring pixels.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { ComparisonCharts } from "../ComparisonCharts";
import type { ComparisonRunData } from "../types";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const EVALUATORS = [
  { id: "accuracy", name: "Accuracy" },
  { id: "exact_match", name: "Exact Match" },
  { id: "factuality_long_judge", name: "Factuality (Long-form Judge)" },
  { id: "tone_alignment", name: "Tone Alignment with Brand Voice" },
  { id: "answer_relevancy", name: "Answer Relevancy" },
  { id: "context_precision", name: "Context Precision @ 10" },
] as const;

const RUN_COLORS = ["#3182ce", "#dd6b20", "#38a169"] as const;

const createHeavyRun = (runIndex: number): ComparisonRunData => {
  const runId = `run-${runIndex + 1}`;
  return {
    runId,
    runName: `Run ${runIndex + 1}`,
    color: RUN_COLORS[runIndex] ?? "#3182ce",
    isLoading: false,
    data: {
      runId,
      experimentId: "exp-1",
      projectId: "project-1",
      createdAt: Date.now() - (3 - runIndex) * 60_000,
      datasetColumns: [{ name: "input", hasImages: false }],
      targetColumns: [
        {
          id: `target-${runIndex + 1}`,
          name: `Target ${runIndex + 1}`,
          type: "prompt" as const,
          outputFields: ["output"],
          metadata: { model: `openai/gpt-${4 - runIndex}` },
        },
      ],
      evaluatorIds: EVALUATORS.map((e) => e.id),
      evaluatorNames: Object.fromEntries(EVALUATORS.map((e) => [e.id, e.name])),
      rows: [
        {
          index: 0,
          datasetEntry: { input: "sample input" },
          targets: {
            [`target-${runIndex + 1}`]: {
              targetId: `target-${runIndex + 1}`,
              output: { output: "response" },
              cost: 0.001,
              duration: 500,
              error: null,
              traceId: null,
              evaluatorResults: EVALUATORS.map((e, i) => ({
                evaluatorId: e.id,
                evaluatorName: e.name,
                status: "processed" as const,
                score: 0.5 + (i * 0.05 + runIndex * 0.02),
                passed: i % 2 === 0,
              })),
            },
          },
        },
      ],
    },
  };
};

const HEAVY_FIXTURE: ComparisonRunData[] = [
  createHeavyRun(0),
  createHeavyRun(1),
  createHeavyRun(2),
];

const renderHeavyComparison = () => {
  const result = render(
    <ComparisonCharts comparisonData={HEAVY_FIXTURE} isVisible={true} />,
    { wrapper: Wrapper },
  );
  const chartsRoot = result.container.firstElementChild;
  if (!chartsRoot) {
    throw new Error("ComparisonCharts rendered nothing");
  }
  return { ...result, chartsRoot };
};

describe("ComparisonCharts filter overflow regression (issue #4631)", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given a 3-run x 6-evaluator experiment", () => {
    describe("when the Metrics selector is opened", () => {
      it("renders the dropdown outside the ComparisonCharts subtree", async () => {
        const user = userEvent.setup();
        const { chartsRoot } = renderHeavyComparison();

        await user.click(screen.getByTestId("metrics-selector-button"));

        const dropdown = screen.getByTestId("metrics-dropdown");
        expect(dropdown).toBeInTheDocument();
        // Portal escape: the dropdown DOM must NOT be inside the ComparisonCharts
        // root, otherwise the toolbar's overflow:hidden ancestor will clip it.
        expect(chartsRoot.contains(dropdown)).toBe(false);
      });

      it("constrains its own height so long lists do not exceed the viewport", async () => {
        const user = userEvent.setup();
        renderHeavyComparison();

        await user.click(screen.getByTestId("metrics-selector-button"));

        const dropdown = screen.getByTestId("metrics-dropdown");
        // jsdom returns whatever inline/style value we set, so we can verify the
        // dropdown declares a maxHeight (the implementation may use a clamp
        // such as min(70vh, 480px); we just require *some* explicit ceiling).
        const maxHeight = dropdown.style.maxHeight;
        expect(maxHeight).not.toBe("");
        // Spec also requires scroll-within for tall lists.
        expect(dropdown.style.overflowY).toMatch(/auto|scroll/);
      });
    });

    describe("when the Group by selector is opened", () => {
      it("renders the dropdown outside the ComparisonCharts subtree", async () => {
        const user = userEvent.setup();
        const { chartsRoot } = renderHeavyComparison();

        await user.click(screen.getByTestId("group-by-button"));

        const dropdown = screen.getByTestId("group-by-dropdown");
        expect(dropdown).toBeInTheDocument();
        expect(chartsRoot.contains(dropdown)).toBe(false);
      });
    });
  });
});
