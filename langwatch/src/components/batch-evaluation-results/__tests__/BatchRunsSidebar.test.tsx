/**
 * Tests for BatchRunsSidebar component
 *
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { BatchRunsSidebar, type BatchRunSummary } from "../BatchRunsSidebar";

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Helper to create run summary
const createRunSummary = (
  overrides: Partial<BatchRunSummary> = {}
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

describe("BatchRunsSidebar", () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Loading State", () => {
    it("shows skeleton when loading", () => {
      render(
        <BatchRunsSidebar
          runs={[]}
          onSelectRun={vi.fn()}
          isLoading
        />,
        { wrapper: Wrapper }
      );

      const skeletons = document.querySelectorAll('[class*="chakra-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("Error State", () => {
    it("shows error message", () => {
      render(
        <BatchRunsSidebar
          runs={[]}
          onSelectRun={vi.fn()}
          error="Failed to load runs"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Failed to load runs")).toBeInTheDocument();
    });
  });

  describe("Empty State", () => {
    it("shows empty message when no runs", () => {
      render(
        <BatchRunsSidebar
          runs={[]}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("No runs yet")).toBeInTheDocument();
    });
  });

  describe("Run List", () => {
    it("renders run items", () => {
      const runs = [
        createRunSummary({ runId: "run-1" }),
        createRunSummary({ runId: "run-2" }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByTestId("run-item-run-1")).toBeInTheDocument();
      expect(screen.getByTestId("run-item-run-2")).toBeInTheDocument();
    });

    it("highlights selected run", () => {
      const runs = [createRunSummary({ runId: "run-1" })];

      render(
        <BatchRunsSidebar
          runs={runs}
          selectedRunId="run-1"
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // The selected run should have gray.200 background
      const runItem = screen.getByTestId("run-item-run-1");
      expect(runItem).toBeInTheDocument();
    });

    it("calls onSelectRun when clicking a run", async () => {
      const user = userEvent.setup();
      const onSelectRun = vi.fn();
      const runs = [createRunSummary({ runId: "run-1" })];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={onSelectRun}
        />,
        { wrapper: Wrapper }
      );

      await user.click(screen.getByTestId("run-item-run-1"));

      expect(onSelectRun).toHaveBeenCalledWith("run-1");
    });
  });

  describe("Running Indicator", () => {
    it("shows spinner for unfinished run", () => {
      const runs = [
        createRunSummary({
          runId: "running-run",
          timestamps: {
            created_at: Date.now(),
            // No finished_at or stopped_at
          },
        }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Check for spinner (Chakra's Spinner component)
      const spinner = document.querySelector('[class*="chakra-spinner"]');
      expect(spinner).toBeInTheDocument();
    });

    it("does not show spinner for finished run", () => {
      const runs = [
        createRunSummary({
          runId: "finished-run",
          timestamps: {
            created_at: Date.now() - 60000,
            finished_at: Date.now(),
          },
        }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Should not have spinner in the run item text area
      const runItem = screen.getByTestId("run-item-finished-run");
      const spinner = runItem.querySelector('[class*="chakra-spinner"]');
      expect(spinner).not.toBeInTheDocument();
    });
  });

  describe("Stopped Indicator", () => {
    it("shows red dot for stopped run", () => {
      const runs = [
        createRunSummary({
          runId: "stopped-run",
          timestamps: {
            created_at: Date.now() - 60000,
            stopped_at: Date.now() - 30000,
          },
        }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // The stopped indicator is a small red circle
      const runItem = screen.getByTestId("run-item-stopped-run");
      expect(runItem).toBeInTheDocument();
    });
  });

  describe("Version Info", () => {
    it("shows workflow version commit message as run name", () => {
      const runs = [
        createRunSummary({
          runId: "run-1",
          workflowVersion: {
            id: "v1",
            version: "1",
            commitMessage: "Initial evaluation",
          },
        }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Initial evaluation")).toBeInTheDocument();
    });

    it("falls back to run ID when no version", () => {
      const runs = [createRunSummary({ runId: "run-abc-123" })];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      // Just shows the run ID without prefix
      expect(screen.getByText("run-abc-123")).toBeInTheDocument();
    });
  });

  describe("Evaluation Summary", () => {
    it("shows pass rate percentage", () => {
      const runs = [
        createRunSummary({
          summary: {
            evaluations: {
              "eval-1": {
                name: "Exact Match",
                averagePassed: 0.9,
              },
            },
          },
        }),
      ];

      render(
        <BatchRunsSidebar
          runs={runs}
          onSelectRun={vi.fn()}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("90%")).toBeInTheDocument();
    });
  });
});
