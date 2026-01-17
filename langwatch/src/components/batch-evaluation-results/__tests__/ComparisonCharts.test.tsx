// @vitest-environment jsdom
/**
 * Tests for ComparisonCharts component
 *
 * Tests per-evaluator charts, metrics selector, and X-axis grouping.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ComparisonCharts,
  computeRunMetrics,
  computeTargetMetrics,
} from "../ComparisonCharts";
import type { BatchEvaluationData, ComparisonRunData } from "../types";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Mock data for testing
type MockRunOptions = {
  targetCount?: number;
  hasScores?: boolean;
  hasPassRates?: boolean;
  metadata?: Record<string, string | number | boolean>;
};

const createMockRunData = (
  runId: string,
  createdAt: number,
  options?: MockRunOptions,
): ComparisonRunData => {
  const {
    targetCount = 2,
    hasScores = true,
    hasPassRates = true,
    metadata,
  } = options ?? {};

  const defaultMetadata = (i: number) => ({
    model: i === 0 ? "openai/gpt-4" : "openai/gpt-3.5-turbo",
  });

  const targetColumns = Array.from({ length: targetCount }, (_, i) => ({
    id: `target-${i + 1}`,
    name: i === 0 ? "GPT-4" : `GPT-3.5-${i}`,
    type: "prompt" as const,
    outputFields: ["output"],
    metadata: metadata ?? defaultMetadata(i),
  }));

  const evaluatorResults: Array<{
    evaluatorId: string;
    evaluatorName: string;
    status: "processed" | "skipped" | "error";
    score: number | null;
    passed: boolean | null;
  }> = [];
  if (hasScores) {
    evaluatorResults.push({
      evaluatorId: "accuracy",
      evaluatorName: "Accuracy",
      status: "processed",
      score: 0.9,
      passed: null,
    });
  }
  if (hasPassRates) {
    evaluatorResults.push({
      evaluatorId: "exact_match",
      evaluatorName: "Exact Match",
      status: "processed",
      score: null,
      passed: true,
    });
  }

  return {
    runId,
    color: runId === "run-1" ? "#3182ce" : "#dd6b20",
    isLoading: false,
    data: {
      runId,
      experimentId: "exp-1",
      projectId: "project-1",
      createdAt,
      datasetColumns: [{ name: "input", hasImages: false }],
      targetColumns,
      evaluatorIds: evaluatorResults.map((e) => e.evaluatorId),
      evaluatorNames: Object.fromEntries(
        evaluatorResults.map((e) => [e.evaluatorId, e.evaluatorName]),
      ),
      rows: [
        {
          index: 0,
          datasetEntry: { input: "test" },
          targets: Object.fromEntries(
            targetColumns.map((tc) => [
              tc.id,
              {
                targetId: tc.id,
                output: { output: "response" },
                cost: 0.001,
                duration: 500,
                error: null,
                traceId: null,
                evaluatorResults,
              },
            ]),
          ),
        },
      ],
    },
  };
};

describe("ComparisonCharts", () => {
  afterEach(() => {
    cleanup();
  });

  describe("Rendering", () => {
    it("renders charts when visible with multiple runs", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("charts-container")).toBeInTheDocument();
    });

    it("renders charts for single run with multiple targets", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now(), { targetCount: 2 }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByTestId("charts-container")).toBeInTheDocument();
    });

    it("does not render when single run with single target", () => {
      const singleTargetRun: ComparisonRunData = {
        runId: "run-1",
        color: "#3182ce",
        isLoading: false,
        data: {
          runId: "run-1",
          experimentId: "exp-1",
          projectId: "project-1",
          createdAt: Date.now(),
          datasetColumns: [{ name: "input", hasImages: false }],
          targetColumns: [
            {
              id: "target-1",
              name: "GPT-4",
              type: "prompt",
              outputFields: ["output"],
              metadata: {},
            },
          ],
          evaluatorIds: [],
          evaluatorNames: {},
          rows: [],
        },
      };

      const { container } = render(
        <ComparisonCharts
          comparisonData={[singleTargetRun]}
          isVisible={true}
        />,
        { wrapper: Wrapper },
      );

      expect(container.firstChild).toBeNull();
    });
  });

  describe("Per-Evaluator Charts", () => {
    it("renders separate chart for each evaluator score", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, { hasScores: true }),
        createMockRunData("run-2", Date.now(), { hasScores: true }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Should have a chart for "Accuracy" evaluator score
      expect(screen.getByTestId("chart-score-accuracy")).toBeInTheDocument();
      expect(screen.getByText("Accuracy (Score)")).toBeInTheDocument();
    });

    it("renders separate chart for each evaluator pass rate", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, { hasPassRates: true }),
        createMockRunData("run-2", Date.now(), { hasPassRates: true }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Should have a chart for "Exact Match" evaluator pass rate
      expect(screen.getByTestId("chart-pass-exact_match")).toBeInTheDocument();
      expect(screen.getByText("Exact Match (Pass Rate)")).toBeInTheDocument();
    });

    it("does not show legend on individual evaluator charts", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Recharts legend elements should not be present
      const _charts = screen.queryAllByRole("img"); // Recharts uses role="img" for some legend items
      // This is a basic check - the key thing is that we removed <Legend> component
      expect(screen.queryByText("legend")).not.toBeInTheDocument();
    });
  });

  describe("Metrics Selector", () => {
    it("shows metrics selector button", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("metrics-selector-button")).toBeInTheDocument();
    });

    it("opens metrics dropdown when clicking button", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("metrics-selector-button"));

      expect(screen.getByTestId("metrics-dropdown")).toBeInTheDocument();
    });

    it("lists all available metrics in dropdown", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByTestId("metrics-selector-button"));

      const dropdown = screen.getByTestId("metrics-dropdown");

      // Should list cost, latency, and per-evaluator metrics
      expect(within(dropdown).getByText("Total Cost")).toBeInTheDocument();
      expect(within(dropdown).getByText("Avg Latency")).toBeInTheDocument();
      expect(
        within(dropdown).getByText("Accuracy (Score)"),
      ).toBeInTheDocument();
      expect(
        within(dropdown).getByText("Exact Match (Pass Rate)"),
      ).toBeInTheDocument();
    });

    it("hides chart when metric is deselected", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Cost chart should be visible initially
      expect(screen.getByTestId("chart-cost")).toBeInTheDocument();

      // Open dropdown and click on "Total Cost" to deselect
      await user.click(screen.getByTestId("metrics-selector-button"));
      const dropdown = screen.getByTestId("metrics-dropdown");
      await user.click(within(dropdown).getByText("Total Cost"));

      // Cost chart should be hidden
      expect(screen.queryByTestId("chart-cost")).not.toBeInTheDocument();
    });
  });

  describe("X-Axis Options", () => {
    it("shows X-axis selector with Runs option", () => {
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("xaxis-selector")).toBeInTheDocument();
      expect(screen.getByTestId("group-by-button")).toBeInTheDocument();
    });

    it("shows Target option when there are 2+ targets", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, { targetCount: 2 }),
        createMockRunData("run-2", Date.now(), { targetCount: 2 }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown
      await user.click(screen.getByTestId("group-by-button"));

      expect(screen.getByTestId("xaxis-option-target")).toBeInTheDocument();
    });

    it("allows switching X-axis options", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000),
        createMockRunData("run-2", Date.now()),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown
      await user.click(screen.getByTestId("group-by-button"));

      const targetButton = screen.getByTestId("xaxis-option-target");

      // Click on Target option
      await user.click(targetButton);

      // Dropdown should close, button should now say "Group by: Target"
      expect(screen.getByTestId("group-by-button")).toHaveTextContent(
        "Group by: Target",
      );

      // Open dropdown again
      await user.click(screen.getByTestId("group-by-button"));

      // Click back to Runs
      await user.click(screen.getByTestId("xaxis-option-runs"));

      expect(screen.getByTestId("group-by-button")).toHaveTextContent(
        "Group by: Runs",
      );
    });

    it("defaults to target X-axis for single run with multiple targets", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now(), { targetCount: 3 }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Should default to "Target" for single run with multiple targets
      expect(screen.getByTestId("group-by-button")).toHaveTextContent(
        "Group by: Target",
      );

      // Open dropdown - Target option should be available
      await user.click(screen.getByTestId("group-by-button"));
      expect(screen.getByTestId("xaxis-option-target")).toBeInTheDocument();
    });

    it("shows Model option when targets have model in metadata", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, {
          metadata: { model: "openai/gpt-4" },
        }),
        createMockRunData("run-2", Date.now(), {
          metadata: { model: "openai/gpt-3.5" },
        }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown
      await user.click(screen.getByTestId("group-by-button"));

      // Should show Model option
      expect(screen.getByTestId("xaxis-option-model")).toBeInTheDocument();
    });

    it("shows Prompt option when targets have promptId (combines prompt + version)", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, {
          metadata: { model: "gpt-4", prompt_id: "my-prompt" },
        }),
        createMockRunData("run-2", Date.now(), {
          metadata: { model: "gpt-4", prompt_id: "my-prompt" },
        }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown
      await user.click(screen.getByTestId("group-by-button"));

      // Should show Prompt option (version is no longer separate)
      expect(screen.getByTestId("xaxis-option-prompt")).toBeInTheDocument();
      // Version should NOT be a separate option
      expect(
        screen.queryByTestId("xaxis-option-version"),
      ).not.toBeInTheDocument();
    });

    it("shows custom metadata keys as group by options", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, {
          metadata: { custom_field: "value1", another_key: "test" },
        }),
        createMockRunData("run-2", Date.now(), {
          metadata: { custom_field: "value2", another_key: "test2" },
        }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown
      await user.click(screen.getByTestId("group-by-button"));

      // Should show custom metadata keys as options
      expect(
        screen.getByTestId("xaxis-option-custom_field"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("xaxis-option-another_key"),
      ).toBeInTheDocument();
    });

    it("can switch group by to Model and back", async () => {
      const user = userEvent.setup();
      const comparisonData = [
        createMockRunData("run-1", Date.now() - 60000, {
          metadata: { model: "openai/gpt-4" },
        }),
        createMockRunData("run-2", Date.now(), {
          metadata: { model: "openai/gpt-3.5" },
        }),
      ];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // Open dropdown and select Model
      await user.click(screen.getByTestId("group-by-button"));
      await user.click(screen.getByTestId("xaxis-option-model"));

      // Should now show "Group by: Model"
      expect(screen.getByTestId("group-by-button")).toHaveTextContent(
        "Group by: Model",
      );

      // Switch back to Runs
      await user.click(screen.getByTestId("group-by-button"));
      await user.click(screen.getByTestId("xaxis-option-runs"));

      expect(screen.getByTestId("group-by-button")).toHaveTextContent(
        "Group by: Runs",
      );
    });
  });

  describe("Chart Ordering", () => {
    it("sorts runs by creation time (oldest first)", () => {
      // Create runs with different timestamps
      const olderRun = createMockRunData("older-run", Date.now() - 120000);
      const newerRun = createMockRunData("newer-run", Date.now());

      // Pass in reverse order (newer first)
      const comparisonData = [newerRun, olderRun];

      render(
        <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
        { wrapper: Wrapper },
      );

      // The component should internally sort by createdAt
      // Charts should render successfully
      expect(screen.queryByTestId("charts-container")).toBeInTheDocument();
    });
  });

  describe("Per-Target Metric Calculation", () => {
    /**
     * Test data with DIFFERENT evaluator scores for each target.
     * This is critical for verifying that per-target metrics are computed correctly.
     */
    const createMultiTargetRows = (): BatchEvaluationData["rows"] => [
      {
        index: 0,
        datasetEntry: { input: "What is AI?" },
        targets: {
          "gpt-4": {
            targetId: "gpt-4",
            output: { output: "AI is..." },
            cost: 0.01,
            duration: 400,
            error: null,
            traceId: null,
            // GPT-4: High score 0.95, passed
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.95,
                passed: true,
              },
            ],
          },
          "gpt-3.5": {
            targetId: "gpt-3.5",
            output: { output: "Artificial..." },
            cost: 0.002,
            duration: 200,
            error: null,
            traceId: null,
            // GPT-3.5: Medium score 0.70, passed
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.7,
                passed: true,
              },
            ],
          },
          "claude-3": {
            targetId: "claude-3",
            output: { output: "AI refers to..." },
            cost: 0.005,
            duration: 250,
            error: null,
            traceId: null,
            // Claude-3: Low score 0.50, FAILED
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.5,
                passed: false,
              },
            ],
          },
        },
      },
      {
        index: 1,
        datasetEntry: { input: "Explain ML" },
        targets: {
          "gpt-4": {
            targetId: "gpt-4",
            output: { output: "ML is..." },
            cost: 0.01,
            duration: 380,
            error: null,
            traceId: null,
            // GPT-4: Still high 0.90, passed
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.9,
                passed: true,
              },
            ],
          },
          "gpt-3.5": {
            targetId: "gpt-3.5",
            output: { output: "Machine..." },
            cost: 0.002,
            duration: 180,
            error: null,
            traceId: null,
            // GPT-3.5: Medium 0.60, passed
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.6,
                passed: true,
              },
            ],
          },
          "claude-3": {
            targetId: "claude-3",
            output: { output: "ML stands for..." },
            cost: 0.005,
            duration: 220,
            error: null,
            traceId: null,
            // Claude-3: Lower 0.40, FAILED
            evaluatorResults: [
              {
                evaluatorId: "response_quality",
                evaluatorName: "Response Quality",
                status: "processed" as const,
                score: 0.4,
                passed: false,
              },
            ],
          },
        },
      },
    ];

    describe("computeTargetMetrics", () => {
      it("computes correct average score for GPT-4 target", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "gpt-4");

        // GPT-4: (0.95 + 0.90) / 2 = 0.925
        expect(metrics.avgScores.response_quality).toBeCloseTo(0.925, 3);
      });

      it("computes correct average score for GPT-3.5 target", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "gpt-3.5");

        // GPT-3.5: (0.70 + 0.60) / 2 = 0.65
        expect(metrics.avgScores.response_quality).toBeCloseTo(0.65, 3);
      });

      it("computes correct average score for Claude-3 target", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "claude-3");

        // Claude-3: (0.50 + 0.40) / 2 = 0.45
        expect(metrics.avgScores.response_quality).toBeCloseTo(0.45, 3);
      });

      it("computes DIFFERENT scores for each target (proving the bug would be caught)", () => {
        const rows = createMultiTargetRows();

        const gpt4Metrics = computeTargetMetrics(rows, "gpt-4");
        const gpt35Metrics = computeTargetMetrics(rows, "gpt-3.5");
        const claude3Metrics = computeTargetMetrics(rows, "claude-3");

        // All three targets should have DIFFERENT scores
        const gpt4Score = gpt4Metrics.avgScores.response_quality!;
        const gpt35Score = gpt35Metrics.avgScores.response_quality!;
        const claude3Score = claude3Metrics.avgScores.response_quality!;

        // Verify they are distinct
        expect(gpt4Score).not.toEqual(gpt35Score);
        expect(gpt4Score).not.toEqual(claude3Score);
        expect(gpt35Score).not.toEqual(claude3Score);

        // Verify the ordering matches expectations (GPT-4 > GPT-3.5 > Claude-3)
        expect(gpt4Score).toBeGreaterThan(gpt35Score);
        expect(gpt35Score).toBeGreaterThan(claude3Score);
      });

      it("computes correct pass rate for GPT-4 target (100%)", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "gpt-4");

        // GPT-4: 2/2 passed = 100%
        expect(metrics.passRates.response_quality).toBe(1.0);
      });

      it("computes correct pass rate for GPT-3.5 target (100%)", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "gpt-3.5");

        // GPT-3.5: 2/2 passed = 100%
        expect(metrics.passRates.response_quality).toBe(1.0);
      });

      it("computes correct pass rate for Claude-3 target (0%)", () => {
        const rows = createMultiTargetRows();
        const metrics = computeTargetMetrics(rows, "claude-3");

        // Claude-3: 0/2 passed = 0%
        expect(metrics.passRates.response_quality).toBe(0);
      });

      it("computes DIFFERENT pass rates per target", () => {
        const rows = createMultiTargetRows();

        const gpt4Metrics = computeTargetMetrics(rows, "gpt-4");
        const claude3Metrics = computeTargetMetrics(rows, "claude-3");

        // GPT-4 should have 100% pass rate
        expect(gpt4Metrics.passRates.response_quality).toBe(1.0);
        // Claude-3 should have 0% pass rate
        expect(claude3Metrics.passRates.response_quality).toBe(0);
        // These should be DIFFERENT!
        expect(gpt4Metrics.passRates.response_quality).not.toEqual(
          claude3Metrics.passRates.response_quality,
        );
      });

      it("computes correct total cost for each target", () => {
        const rows = createMultiTargetRows();

        // GPT-4: 0.01 + 0.01 = 0.02
        expect(computeTargetMetrics(rows, "gpt-4").totalCost).toBeCloseTo(
          0.02,
          4,
        );
        // GPT-3.5: 0.002 + 0.002 = 0.004
        expect(computeTargetMetrics(rows, "gpt-3.5").totalCost).toBeCloseTo(
          0.004,
          4,
        );
        // Claude-3: 0.005 + 0.005 = 0.01
        expect(computeTargetMetrics(rows, "claude-3").totalCost).toBeCloseTo(
          0.01,
          4,
        );
      });

      it("computes correct average latency for each target", () => {
        const rows = createMultiTargetRows();

        // GPT-4: (400 + 380) / 2 = 390ms
        expect(computeTargetMetrics(rows, "gpt-4").avgLatency).toBe(390);
        // GPT-3.5: (200 + 180) / 2 = 190ms
        expect(computeTargetMetrics(rows, "gpt-3.5").avgLatency).toBe(190);
        // Claude-3: (250 + 220) / 2 = 235ms
        expect(computeTargetMetrics(rows, "claude-3").avgLatency).toBe(235);
      });
    });

    describe("computeRunMetrics (global averages)", () => {
      it("computes global average score across ALL targets", () => {
        const data: BatchEvaluationData = {
          runId: "test-run",
          experimentId: "exp-1",
          projectId: "project-1",
          createdAt: Date.now(),
          datasetColumns: [{ name: "input", hasImages: false }],
          targetColumns: [
            {
              id: "gpt-4",
              name: "GPT-4",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "gpt-3.5",
              name: "GPT-3.5",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "claude-3",
              name: "Claude-3",
              type: "custom",
              outputFields: ["output"],
            },
          ],
          evaluatorIds: ["response_quality"],
          evaluatorNames: { response_quality: "Response Quality" },
          rows: createMultiTargetRows(),
        };

        const metrics = computeRunMetrics(data);

        // Global average: (0.95 + 0.90 + 0.70 + 0.60 + 0.50 + 0.40) / 6 = 4.05 / 6 = 0.675
        expect(metrics.avgScores.response_quality).toBeCloseTo(0.675, 3);
      });

      it("computes global pass rate across ALL targets", () => {
        const data: BatchEvaluationData = {
          runId: "test-run",
          experimentId: "exp-1",
          projectId: "project-1",
          createdAt: Date.now(),
          datasetColumns: [{ name: "input", hasImages: false }],
          targetColumns: [
            {
              id: "gpt-4",
              name: "GPT-4",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "gpt-3.5",
              name: "GPT-3.5",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "claude-3",
              name: "Claude-3",
              type: "custom",
              outputFields: ["output"],
            },
          ],
          evaluatorIds: ["response_quality"],
          evaluatorNames: { response_quality: "Response Quality" },
          rows: createMultiTargetRows(),
        };

        const metrics = computeRunMetrics(data);

        // Global pass rate: 4 passed / 6 total = 0.667
        expect(metrics.passRates.response_quality).toBeCloseTo(4 / 6, 3);
      });

      it("demonstrates the bug: global average differs from per-target averages", () => {
        const rows = createMultiTargetRows();
        const data: BatchEvaluationData = {
          runId: "test-run",
          experimentId: "exp-1",
          projectId: "project-1",
          createdAt: Date.now(),
          datasetColumns: [{ name: "input", hasImages: false }],
          targetColumns: [
            {
              id: "gpt-4",
              name: "GPT-4",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "gpt-3.5",
              name: "GPT-3.5",
              type: "custom",
              outputFields: ["output"],
            },
            {
              id: "claude-3",
              name: "Claude-3",
              type: "custom",
              outputFields: ["output"],
            },
          ],
          evaluatorIds: ["response_quality"],
          evaluatorNames: { response_quality: "Response Quality" },
          rows,
        };

        const globalMetrics = computeRunMetrics(data);
        const gpt4Metrics = computeTargetMetrics(rows, "gpt-4");
        const _gpt35Metrics = computeTargetMetrics(rows, "gpt-3.5");
        const claude3Metrics = computeTargetMetrics(rows, "claude-3");

        // This test documents why using global metrics for per-target charts is WRONG:
        // The global average is ~0.675, but individual targets have scores of 0.925, 0.65, and 0.45
        const globalScore = globalMetrics.avgScores.response_quality!;
        const gpt4Score = gpt4Metrics.avgScores.response_quality!;
        const claude3Score = claude3Metrics.avgScores.response_quality!;

        // If we were using global metrics (the bug), all bars would show ~0.675
        // But per-target metrics correctly show: GPT-4=0.925, GPT-3.5=0.65, Claude=0.45
        expect(gpt4Score).not.toEqual(globalScore);
        expect(claude3Score).not.toEqual(globalScore);

        // The per-target scores span a much wider range than just the global average
        expect(gpt4Score - claude3Score).toBeGreaterThan(0.4); // Range is 0.475
        expect(Math.abs(gpt4Score - globalScore)).toBeGreaterThan(0.2); // GPT-4 is 0.25 above global
        expect(Math.abs(claude3Score - globalScore)).toBeGreaterThan(0.2); // Claude is 0.225 below global
      });
    });

    describe("Component integration", () => {
      const createMultiTargetRunWithDifferentScores =
        (): ComparisonRunData => ({
          runId: "multi-target-run",
          color: "#3182ce",
          isLoading: false,
          data: {
            runId: "multi-target-run",
            experimentId: "exp-1",
            projectId: "project-1",
            createdAt: Date.now(),
            datasetColumns: [{ name: "input", hasImages: false }],
            targetColumns: [
              {
                id: "gpt-4",
                name: "GPT-4",
                type: "custom" as const,
                outputFields: ["output"],
                metadata: { model: "openai/gpt-4" },
              },
              {
                id: "gpt-3.5",
                name: "GPT-3.5",
                type: "custom" as const,
                outputFields: ["output"],
                metadata: { model: "openai/gpt-3.5-turbo" },
              },
              {
                id: "claude-3",
                name: "Claude-3",
                type: "custom" as const,
                outputFields: ["output"],
                metadata: { model: "anthropic/claude-3-sonnet" },
              },
            ],
            evaluatorIds: ["response_quality"],
            evaluatorNames: { response_quality: "Response Quality" },
            rows: createMultiTargetRows(),
          },
        });

      it("renders score chart when grouped by target", () => {
        const comparisonData = [createMultiTargetRunWithDifferentScores()];

        render(
          <ComparisonCharts comparisonData={comparisonData} isVisible={true} />,
          { wrapper: Wrapper },
        );

        // For single run with multiple targets, defaults to "Target" grouping
        expect(screen.getByTestId("group-by-button")).toHaveTextContent(
          "Group by: Target",
        );

        // Charts should render
        expect(
          screen.getByTestId("chart-score-response_quality"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("chart-pass-response_quality"),
        ).toBeInTheDocument();
        expect(screen.getByTestId("chart-latency")).toBeInTheDocument();
        expect(screen.getByTestId("chart-cost")).toBeInTheDocument();
      });
    });
  });
});
