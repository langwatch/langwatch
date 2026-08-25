/**
 * Tests for BatchEvaluationResultsTable component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchEvaluationResultsTable } from "../BatchEvaluationResultsTable";
import type { BatchEvaluationData, ComparisonRunData } from "@langwatch/experiment-web";

// Mock the drawer hook
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
}));

// TraceIdPeek (rendered transitively) calls useFeatureFlag → tRPC, which has
// no withTRPC wrapper in these tests.
vi.mock("~/hooks/useFeatureFlag", () => ({
  useFeatureFlag: () => ({ enabled: false, isLoading: false }),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create test data
const createTestData = (
  overrides: Partial<BatchEvaluationData> = {},
): BatchEvaluationData => ({
  runId: "run-1",
  experimentId: "exp-1",
  projectId: "proj-1",
  createdAt: Date.now(),
  datasetColumns: [
    { name: "input", hasImages: false },
    { name: "expected", hasImages: false },
  ],
  targetColumns: [
    {
      id: "target-1",
      name: "GPT-4o",
      type: "prompt",
      outputFields: ["response"],
    },
  ],
  evaluatorIds: ["eval-1"],
  evaluatorNames: { "eval-1": "Exact Match" },
  comparisonColumns: [],
  rows: [
    {
      index: 0,
      datasetEntry: { input: "What is 2+2?", expected: "4" },
      targets: {
        "target-1": {
          targetId: "target-1",
          output: { response: "4" },
          cost: 0.001,
          duration: 500,
          error: null,
          traceId: "trace-1",
          evaluatorResults: [
            {
              evaluatorId: "eval-1",
              evaluatorName: "Exact Match",
              status: "processed",
              score: 1.0,
              passed: true,
            },
          ],
        },
      },
    },
  ],
  ...overrides,
});

describe("BatchEvaluationResultsTable", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Loading State", () => {
    /** @scenario Show loading skeleton while fetching results */
    it("shows skeleton when loading", () => {
      render(
        <BatchEvaluationResultsTable data={null} isLoading disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      // Check for skeleton elements
      const skeletons = document.querySelectorAll('[class*="chakra-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Empty State", () => {
    /** @scenario Show empty state when no results */
    it("shows empty message when no data", () => {
      render(
        <BatchEvaluationResultsTable
          data={null}
          isLoading={false}
          disableVirtualization
        />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.getByText("No results to display")).toBeInTheDocument();
    });

    it("shows empty message when rows is empty", () => {
      const data = createTestData({ rows: [] });

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("No results to display")).toBeInTheDocument();
    });
  });

  describe("Column Headers", () => {
    it("renders row number column (empty header, shows row numbers in cells)", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      // Row number column has empty header but shows numbers in cells
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    /** @scenario Display dataset columns in the table */
    it("renders dataset column headers", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      // Column names appear in both the table header and the column visibility popover
      // Check that at least one instance exists
      expect(screen.getAllByText("input").length).toBeGreaterThan(0);
      expect(screen.getAllByText("expected").length).toBeGreaterThan(0);
    });

    /** @scenario Display target output columns */
    /** @scenario Display V3 evaluations with multiple targets */
    it("renders target column headers", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    });
  });

  describe("Row Data", () => {
    it("renders row number", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("renders dataset values", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
      // Note: "4" appears multiple times (expected, output)
      expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    });

    it("renders target output", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      // The output is JSON stringified
      expect(screen.getByText(/response/)).toBeInTheDocument();
    });

    it("renders evaluator chips", () => {
      const data = createTestData();

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Exact Match")).toBeInTheDocument();
    });
  });

  describe("Multiple Rows", () => {
    it("renders all rows", () => {
      const data = createTestData({
        rows: [
          {
            index: 0,
            datasetEntry: { input: "Row 1 input", expected: "output1" },
            targets: {
              "target-1": {
                targetId: "target-1",
                output: { response: "Response 1" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
            },
          },
          {
            index: 1,
            datasetEntry: { input: "Row 2 input", expected: "output2" },
            targets: {
              "target-1": {
                targetId: "target-1",
                output: { response: "Response 2" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
            },
          },
        ],
      });

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Row 1 input")).toBeInTheDocument();
      expect(screen.getByText("Row 2 input")).toBeInTheDocument();
      expect(screen.getByText("1")).toBeInTheDocument();
      expect(screen.getByText("2")).toBeInTheDocument();
    });
  });

  describe("Multiple Targets", () => {
    it("renders columns for each target", () => {
      const data = createTestData({
        targetColumns: [
          { id: "target-1", name: "GPT-4o", type: "prompt", outputFields: [] },
          { id: "target-2", name: "Claude", type: "prompt", outputFields: [] },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { input: "Hello", expected: "Hi" },
            targets: {
              "target-1": {
                targetId: "target-1",
                output: { response: "Hi from GPT" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
              "target-2": {
                targetId: "target-2",
                output: { response: "Hi from Claude" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
            },
          },
        ],
      });

      render(<BatchEvaluationResultsTable data={data} disableVirtualization />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("GPT-4o")).toBeInTheDocument();
      expect(screen.getByText("Claude")).toBeInTheDocument();
      expect(screen.getByText(/Hi from GPT/)).toBeInTheDocument();
      expect(screen.getByText(/Hi from Claude/)).toBeInTheDocument();
    });
  });

  describe("Column Visibility", () => {
    it("hides columns when hiddenColumns prop includes column name", () => {
      const data = createTestData({
        datasetColumns: [
          { name: "id", hasImages: false },
          { name: "input", hasImages: false },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { id: "row-123", input: "Test input" },
            targets: {
              "target-1": {
                targetId: "target-1",
                output: { response: "Test output" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
            },
          },
        ],
      });

      // Pass hidden columns via prop
      const hiddenColumns = new Set(["id"]);

      render(
        <BatchEvaluationResultsTable
          data={data}
          hiddenColumns={hiddenColumns}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      // input column should be visible
      expect(screen.getAllByText("input").length).toBeGreaterThan(0);
      // Since id is hidden, we shouldn't see "row-123" in the table
      expect(screen.queryByText("row-123")).not.toBeInTheDocument();
    });

    it("shows all columns when hiddenColumns is empty", () => {
      const data = createTestData({
        datasetColumns: [
          { name: "id", hasImages: false },
          { name: "input", hasImages: false },
        ],
        rows: [
          {
            index: 0,
            datasetEntry: { id: "row-123", input: "Test input" },
            targets: {
              "target-1": {
                targetId: "target-1",
                output: { response: "Test output" },
                cost: null,
                duration: null,
                error: null,
                traceId: null,
                evaluatorResults: [],
              },
            },
          },
        ],
      });

      // No hidden columns
      const hiddenColumns = new Set<string>();

      render(
        <BatchEvaluationResultsTable
          data={data}
          hiddenColumns={hiddenColumns}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      // Both columns and their values should be visible
      expect(screen.getByText("row-123")).toBeInTheDocument();
      expect(screen.getByText("Test input")).toBeInTheDocument();
    });
  });

  describe("when changing visible result fields", () => {
    /** @scenario Hide scores to focus on outputs */
    it("hides evaluator chips but keeps outputs when showEvaluations is false", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable
          data={data}
          showEvaluations={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      // The output is rendered as JSON, so it is matched via its "response" field.
      expect(screen.getByText(/response/)).toBeInTheDocument();
      expect(screen.queryByText("Exact Match")).not.toBeInTheDocument();
    });

    /** @scenario Hide outputs to focus on scores */
    it("hides outputs but keeps evaluator chips when showOutputs is false", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable
          data={data}
          showOutputs={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Exact Match")).toBeInTheDocument();
      expect(screen.queryByText(/response/)).not.toBeInTheDocument();
    });

    /** @scenario Hide cost and latency to reduce clutter */
    it("hides cost and latency but keeps output when showCostAndLatency is false", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable
          data={data}
          showCostAndLatency={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText(/response/)).toBeInTheDocument();
      expect(screen.queryByTestId("cost-target-1")).not.toBeInTheDocument();
      expect(screen.queryByTestId("latency-target-1")).not.toBeInTheDocument();
    });

    /** @scenario Hide the target column when no fields are shown */
    it("removes the target column when all fields are off", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable
          data={data}
          showOutputs={false}
          showEvaluations={false}
          showCostAndLatency={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument();
      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
    });
  });

  describe("when changing visible result fields in comparison mode", () => {
    const createComparisonRuns = (): ComparisonRunData[] => [
      {
        runId: "run-a",
        runName: "Run A",
        color: "#3182ce",
        data: createTestData({ runId: "run-a" }),
        isLoading: false,
      },
      {
        runId: "run-b",
        runName: "Run B",
        color: "#dd6b20",
        data: createTestData({ runId: "run-b" }),
        isLoading: false,
      },
    ];

    /** @scenario Hide scores to focus on outputs */
    it("hides evaluator chips but keeps outputs when showEvaluations is false", () => {
      render(
        <BatchEvaluationResultsTable
          data={null}
          comparisonData={createComparisonRuns()}
          showEvaluations={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getAllByText(/response/).length).toBeGreaterThan(0);
      expect(screen.queryAllByText("Exact Match")).toHaveLength(0);
    });

    /** @scenario Hide outputs to focus on scores */
    it("hides outputs but keeps evaluator chips when showOutputs is false", () => {
      render(
        <BatchEvaluationResultsTable
          data={null}
          comparisonData={createComparisonRuns()}
          showOutputs={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getAllByText("Exact Match").length).toBeGreaterThan(0);
      expect(screen.queryAllByText(/response/)).toHaveLength(0);
    });

    /** @scenario Hide the target column when no fields are shown */
    it("removes the target column when all fields are off", () => {
      render(
        <BatchEvaluationResultsTable
          data={null}
          comparisonData={createComparisonRuns()}
          showOutputs={false}
          showEvaluations={false}
          showCostAndLatency={false}
          disableVirtualization
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("GPT-4o")).not.toBeInTheDocument();
      expect(screen.getAllByText("What is 2+2?").length).toBeGreaterThan(0);
    });
  });

  describe("when changing row height", () => {
    /** @scenario Increase row height to see more of a long output before expanding */
    it("threads the selected tier down to each cell", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} rowHeight="l" disableVirtualization />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("What is 2+2?").closest("[data-row-height]"),
      ).toHaveAttribute("data-row-height", "l");
      expect(screen.getByText(/response/).closest("[data-row-height]")).toHaveAttribute(
        "data-row-height",
        "l",
      );
    });
  });
});
