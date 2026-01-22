/**
 * Tests for BatchSummaryFooter component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BatchRunSummary } from "../BatchRunsSidebar";
import { BatchSummaryFooter } from "../BatchSummaryFooter";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create run summary
const createRunSummary = (
  overrides: Partial<BatchRunSummary> = {},
): BatchRunSummary => ({
  runId: "run-1",
  timestamps: {
    created_at: Date.now() - 60000, // 1 minute ago
    finished_at: Date.now(),
  },
  summary: {
    datasetCost: 0.01,
    evaluationsCost: 0.005,
    evaluations: {
      "eval-1": {
        name: "Exact Match",
        averageScore: 0.85,
        averagePassed: 0.9,
      },
    },
  },
  ...overrides,
});

describe("BatchSummaryFooter", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Evaluation Stats", () => {
    it("displays evaluation name and pass rate", () => {
      const run = createRunSummary();

      render(<BatchSummaryFooter run={run} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Exact Match")).toBeInTheDocument();
      // The text includes avg score when different from pass rate
      expect(screen.getByText(/90% pass/)).toBeInTheDocument();
    });

    it("displays multiple evaluation summaries", () => {
      const run = createRunSummary({
        summary: {
          evaluations: {
            "eval-1": { name: "Eval A", averagePassed: 0.8 },
            "eval-2": { name: "Eval B", averageScore: 0.75 },
          },
        },
      });

      render(<BatchSummaryFooter run={run} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Eval A")).toBeInTheDocument();
      expect(screen.getByText("Eval B")).toBeInTheDocument();
    });
  });

  describe("Cost Display", () => {
    it("displays total cost", () => {
      const run = createRunSummary({
        summary: {
          datasetCost: 0.1,
          evaluationsCost: 0.05,
          evaluations: {},
        },
      });

      render(<BatchSummaryFooter run={run} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Total Cost")).toBeInTheDocument();
      // Total is 0.15
      expect(screen.getByText("$0.1500")).toBeInTheDocument();
    });
  });

  describe("Runtime", () => {
    it("displays runtime for finished run", () => {
      const now = Date.now();
      const run = createRunSummary({
        timestamps: {
          created_at: now - 65000, // 1:05 ago
          finished_at: now,
        },
      });

      render(<BatchSummaryFooter run={run} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Runtime")).toBeInTheDocument();
      // Should show runtime in format like "00:01:05" - numeral(65).format("00:00:00")
      expect(screen.getByText(/\d+:\d+:\d+/)).toBeInTheDocument();
    });
  });

  describe("Stopped State", () => {
    it("shows stopped indicator", () => {
      const run = createRunSummary({
        timestamps: {
          created_at: Date.now() - 60000,
          stopped_at: Date.now() - 30000,
        },
      });

      render(<BatchSummaryFooter run={run} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Stopped")).toBeInTheDocument();
    });
  });

  describe("Progress Bar", () => {
    it("shows progress bar when showProgress and running", () => {
      const run = createRunSummary({
        timestamps: {
          created_at: Date.now() - 10000,
          // No finished_at
        },
        progress: 5,
        total: 10,
      });

      render(<BatchSummaryFooter run={run} showProgress />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Running")).toBeInTheDocument();
      expect(screen.getByText("5/10")).toBeInTheDocument();
    });

    it("does not show progress bar when finished", () => {
      const run = createRunSummary({
        timestamps: {
          created_at: Date.now() - 60000,
          finished_at: Date.now(),
        },
        progress: 10,
        total: 10,
      });

      render(<BatchSummaryFooter run={run} showProgress />, {
        wrapper: Wrapper,
      });

      expect(screen.queryByText("Running")).not.toBeInTheDocument();
    });
  });

  describe("Stop Button", () => {
    it("shows stop button when onStop provided and running", async () => {
      const onStop = vi.fn();
      const run = createRunSummary({
        timestamps: {
          created_at: Date.now() - 10000,
        },
        progress: 3,
        total: 10,
      });

      render(<BatchSummaryFooter run={run} showProgress onStop={onStop} />, {
        wrapper: Wrapper,
      });

      expect(screen.getByText("Stop")).toBeInTheDocument();
    });

    it("calls onStop when stop button clicked", async () => {
      const user = userEvent.setup();
      const onStop = vi.fn();
      const run = createRunSummary({
        timestamps: {
          created_at: Date.now() - 10000,
        },
        progress: 3,
        total: 10,
      });

      render(<BatchSummaryFooter run={run} showProgress onStop={onStop} />, {
        wrapper: Wrapper,
      });

      await user.click(screen.getByText("Stop"));

      expect(onStop).toHaveBeenCalled();
    });
  });
});
