/**
 * Tests for BatchEvaluationResultsTable component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BatchEvaluationResultsTable } from "../BatchEvaluationResultsTable";
import type { BatchEvaluationData } from "../types";

// Mock the drawer hook
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
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
    it("shows skeleton when loading", () => {
      render(
        <BatchEvaluationResultsTable
          data={null}
          isLoading
          disableVirtualization
        />,
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

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.getByText("No results to display")).toBeInTheDocument();
    });
  });

  describe("Column Headers", () => {
    it("renders row number column (empty header, shows row numbers in cells)", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      // Row number column has empty header but shows numbers in cells
      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("renders dataset column headers", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      // Column names appear in both the table header and the column visibility popover
      // Check that at least one instance exists
      expect(screen.getAllByText("input").length).toBeGreaterThan(0);
      expect(screen.getAllByText("expected").length).toBeGreaterThan(0);
    });

    it("renders target column headers", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.getByText("GPT-4o")).toBeInTheDocument();
    });
  });

  describe("Row Data", () => {
    it("renders row number", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.getByText("1")).toBeInTheDocument();
    });

    it("renders dataset values", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      expect(screen.getByText("What is 2+2?")).toBeInTheDocument();
      // Note: "4" appears multiple times (expected, output)
      expect(screen.getAllByText("4").length).toBeGreaterThan(0);
    });

    it("renders target output", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

      // The output is JSON stringified
      expect(screen.getByText(/response/)).toBeInTheDocument();
    });

    it("renders evaluator chips", () => {
      const data = createTestData();

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

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

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

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

      render(
        <BatchEvaluationResultsTable data={data} disableVirtualization />,
        {
          wrapper: Wrapper,
        },
      );

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
});
