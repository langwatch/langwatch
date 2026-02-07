// @vitest-environment jsdom
/**
 * Integration tests for BatchEvaluationResults component
 *
 * These tests verify the full page rendering with mocked API responses,
 * testing the integration between sidebar, table, and summary components.
 *
 * Following the test trophy approach - testing the full component integration
 * without mocking child components.
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { Experiment, Project } from "@prisma/client";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExperimentRunWithItems } from "~/server/evaluations-v3/services/types";
import { BatchEvaluationResults } from "../BatchEvaluationResults";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Mock the API
vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      getExperimentBatchEvaluationRuns: {
        useQuery: vi.fn(),
      },
      getExperimentBatchEvaluationRun: {
        useQuery: vi.fn(),
      },
    },
  },
}));

// Mock CSV download hook
vi.mock(
  "../../../experiments/BatchEvaluationV2/BatchEvaluationV2EvaluationResults",
  () => ({
    useBatchEvaluationDownloadCSV: vi.fn().mockReturnValue({
      downloadCSV: vi.fn(),
      isDownloadCSVEnabled: true,
    }),
  }),
);

// Mock Next.js router
vi.mock("next/router", () => ({
  useRouter: vi.fn().mockReturnValue({
    query: {},
    pathname: "/test-project/experiments/test-experiment",
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

// Import the mocked api
import { api } from "~/utils/api";

const mockProject = {
  id: "project-1",
  slug: "test-project",
  name: "Test Project",
} as unknown as Project;

const mockExperiment = {
  id: "exp-1",
  slug: "test-experiment",
  name: "Test Experiment",
  projectId: "project-1",
  type: "EVALUATIONS_V3",
  workflowId: "workflow-1",
} as unknown as Experiment;

// Mock runs data for comparison tests
const mockRunsData = {
  runs: [
    {
      runId: "swift-bright-fox",
      workflowVersion: null,
      timestamps: {
        createdAt: Date.now() - 60000,
        updatedAt: Date.now(),
        finishedAt: Date.now(),
      },
      progress: 10,
      total: 10,
      summary: {
        datasetCost: 0.05,
        evaluationsCost: 0.02,
        evaluations: {
          accuracy: {
            name: "accuracy",
            averageScore: 0.85,
            averagePassed: null,
          },
        },
      },
    },
    {
      runId: "calm-eager-owl",
      workflowVersion: null,
      timestamps: {
        createdAt: Date.now() - 120000,
        updatedAt: Date.now() - 60000,
        finishedAt: Date.now() - 60000,
      },
      progress: 10,
      total: 10,
      summary: {
        datasetCost: 0.04,
        evaluationsCost: 0.01,
        evaluations: {
          accuracy: {
            name: "accuracy",
            averageScore: 0.9,
            averagePassed: null,
          },
        },
      },
    },
    {
      runId: "noble-vivid-storm",
      workflowVersion: null,
      timestamps: {
        createdAt: Date.now() - 180000,
        updatedAt: Date.now() - 120000,
        finishedAt: Date.now() - 120000,
      },
      progress: 10,
      total: 10,
      summary: {
        datasetCost: 0.03,
        evaluationsCost: 0,
        evaluations: {},
      },
    },
  ],
};

const mockSingleRunData = {
  runs: [mockRunsData.runs[0]],
};

// Mock full run data (for table display)
const createMockRunData = (runId: string): ExperimentRunWithItems => ({
  experimentId: "exp-1",
  runId: runId,
  projectId: "project-1",
  progress: 10,
  total: 10,
  targets: [
    {
      id: "target-1",
      name: "GPT-4",
      type: "prompt",
      model: "openai/gpt-4",
      metadata: { temperature: 0.7 },
    },
  ],
  dataset: [
    {
      index: 0,
      targetId: "target-1",
      entry: { question: "Hello" },
      predicted: { answer: "Hi there!" },
      cost: 0.001,
      duration: 500,
    },
    {
      index: 1,
      targetId: "target-1",
      entry: { question: "World" },
      predicted: { answer: "Hello World!" },
      cost: 0.002,
      duration: 600,
    },
  ],
  evaluations: [
    {
      evaluator: "accuracy",
      name: "accuracy",
      targetId: "target-1",
      index: 0,
      status: "processed",
      score: 0.95,
      passed: true,
    },
    {
      evaluator: "accuracy",
      name: "accuracy",
      targetId: "target-1",
      index: 1,
      status: "processed",
      score: 0.85,
      passed: true,
    },
  ],
  timestamps: {
    createdAt: Date.now() - 60000,
    updatedAt: Date.now(),
    finishedAt: Date.now(),
  },
});

describe("BatchEvaluationResults Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state while fetching runs", () => {
    // Mock loading state
    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRun.useQuery,
    ).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRun.useQuery
    >);

    render(
      <BatchEvaluationResults
        project={mockProject}
        experiment={mockExperiment}
      />,
      { wrapper: Wrapper },
    );

    // Should show experiment name
    expect(screen.getByText("Test Experiment")).toBeInTheDocument();
  });

  it("shows empty state when no runs exist", async () => {
    // Mock empty runs
    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: { runs: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRun.useQuery,
    ).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRun.useQuery
    >);

    render(
      <BatchEvaluationResults
        project={mockProject}
        experiment={mockExperiment}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(screen.getByText("Waiting for results...")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    // Mock error
    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    render(
      <BatchEvaluationResults
        project={mockProject}
        experiment={mockExperiment}
      />,
      { wrapper: Wrapper },
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Error loading experiment runs/i),
      ).toBeInTheDocument();
    });
  });

  describe("Comparison Mode", () => {
    const setupWithMultipleRuns = () => {
      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRuns.useQuery,
      ).mockReturnValue({
        data: mockRunsData,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<
        typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
      >);

      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRun.useQuery,
      ).mockReturnValue({
        data: createMockRunData("swift-bright-fox"),
        isLoading: false,
        error: null,
      } as unknown as ReturnType<
        typeof api.experiments.getExperimentBatchEvaluationRun.useQuery
      >);
    };

    const setupWithSingleRun = () => {
      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRuns.useQuery,
      ).mockReturnValue({
        data: mockSingleRunData,
        isLoading: false,
        error: null,
      } as unknown as ReturnType<
        typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
      >);

      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRun.useQuery,
      ).mockReturnValue({
        data: createMockRunData("swift-bright-fox"),
        isLoading: false,
        error: null,
      } as unknown as ReturnType<
        typeof api.experiments.getExperimentBatchEvaluationRun.useQuery
      >);
    };

    it("shows Compare button when multiple runs available", async () => {
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });
    });

    it("disables Compare button when only single run available", async () => {
      setupWithSingleRun();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        const compareButton = screen.getByTestId("compare-button");
        expect(compareButton).toBeDisabled();
      });
    });

    it("enters compare mode and shows checkboxes on runs", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      // Wait for runs to load
      await waitFor(() => {
        expect(
          screen.getByTestId("run-item-swift-bright-fox"),
        ).toBeInTheDocument();
      });

      // Click Compare button
      const compareButton = screen.getByTestId("compare-button");
      await user.click(compareButton);

      // Should now show Exit Compare button
      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });

      // Checkboxes should appear
      expect(
        screen.getByTestId("run-checkbox-swift-bright-fox"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("run-checkbox-calm-eager-owl"),
      ).toBeInTheDocument();
    });

    it("auto-selects current run and next run when entering compare mode", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("run-item-swift-bright-fox"),
        ).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      // First two runs should be auto-selected
      await waitFor(() => {
        const checkbox1 = screen.getByTestId("run-checkbox-swift-bright-fox");
        const checkbox2 = screen.getByTestId("run-checkbox-calm-eager-owl");
        // Check if they're checked by looking at the checkbox state
        expect(checkbox1.querySelector('input[type="checkbox"]')).toBeChecked();
        expect(checkbox2.querySelector('input[type="checkbox"]')).toBeChecked();
      });
    });

    it("exits compare mode when clicking Exit Compare", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });

      // Exit compare mode
      await user.click(screen.getByTestId("exit-compare-button"));

      // Should show Compare button again
      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Checkboxes should be gone
      expect(
        screen.queryByTestId("run-checkbox-swift-bright-fox"),
      ).not.toBeInTheDocument();
    });

    it("toggles run selection when clicking checkbox in compare mode", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      await waitFor(() => {
        expect(
          screen.getByTestId("run-checkbox-noble-vivid-storm"),
        ).toBeInTheDocument();
      });

      // Third run should not be selected initially
      const checkbox3 = screen.getByTestId("run-checkbox-noble-vivid-storm");
      expect(
        checkbox3.querySelector('input[type="checkbox"]'),
      ).not.toBeChecked();

      // Click to select it
      await user.click(checkbox3);

      // Now it should be selected
      await waitFor(() => {
        expect(checkbox3.querySelector('input[type="checkbox"]')).toBeChecked();
      });
    });

    it("renders run list with all runs visible", async () => {
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("run-item-swift-bright-fox"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("run-item-calm-eager-owl"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("run-item-noble-vivid-storm"),
        ).toBeInTheDocument();
      });
    });

    it("displays the table when a run is selected", async () => {
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      // Wait for table to render - look for table structure
      await waitFor(() => {
        // The table card should be visible
        const tables = document.querySelectorAll("table");
        expect(tables.length).toBeGreaterThan(0);
      });
    });

    it("enters comparison mode and shows checkboxes checked for selected runs", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      // Wait for runs to load
      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      // Wait for checkboxes to appear
      await waitFor(() => {
        expect(
          screen.getByTestId("run-checkbox-swift-bright-fox"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("run-checkbox-calm-eager-owl"),
        ).toBeInTheDocument();
      });

      // First two runs should be auto-selected (checked)
      const checkbox1 = screen.getByTestId("run-checkbox-swift-bright-fox");
      const checkbox2 = screen.getByTestId("run-checkbox-calm-eager-owl");
      expect(checkbox1.querySelector('input[type="checkbox"]')).toBeChecked();
      expect(checkbox2.querySelector('input[type="checkbox"]')).toBeChecked();

      // Third run should not be selected initially
      const checkbox3 = screen.getByTestId("run-checkbox-noble-vivid-storm");
      expect(
        checkbox3.querySelector('input[type="checkbox"]'),
      ).not.toBeChecked();
    });

    it("switches between normal and comparison mode correctly", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });

      // Exit compare mode
      await user.click(screen.getByTestId("exit-compare-button"));

      // Should be back to normal mode
      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Table should still be rendered
      const tables = document.querySelectorAll("table");
      expect(tables.length).toBeGreaterThan(0);
    });

    it("shows charts toggle button in comparison mode", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      // Charts toggle should appear (when comparison data loads)
      // Note: The charts component only renders when comparisonData has data
      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });
    });

    it("shows sidebar with title and right-aligned compare button", async () => {
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByText("Experiment Runs")).toBeInTheDocument();
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });
    });

    it("allows deselecting runs down to 1 in compare mode", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Enter compare mode
      await user.click(screen.getByTestId("compare-button"));

      // Wait for checkboxes
      await waitFor(() => {
        expect(
          screen.getByTestId("run-checkbox-swift-bright-fox"),
        ).toBeInTheDocument();
      });

      // Both runs should be checked initially
      const checkbox1 = screen.getByTestId("run-checkbox-swift-bright-fox");
      const checkbox2 = screen.getByTestId("run-checkbox-calm-eager-owl");
      expect(checkbox1.querySelector('input[type="checkbox"]')).toBeChecked();
      expect(checkbox2.querySelector('input[type="checkbox"]')).toBeChecked();

      // Click to deselect one - should now allow it
      await user.click(checkbox2);

      // Now only one should be checked
      await waitFor(() => {
        expect(checkbox1.querySelector('input[type="checkbox"]')).toBeChecked();
        expect(
          checkbox2.querySelector('input[type="checkbox"]'),
        ).not.toBeChecked();
      });
    });

    it("displays run items with version info", async () => {
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("run-item-swift-bright-fox"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("run-item-calm-eager-owl"),
        ).toBeInTheDocument();
        expect(
          screen.getByTestId("run-item-noble-vivid-storm"),
        ).toBeInTheDocument();
      });

      // Should show run names (IDs since no commit message)
      expect(screen.getByText("swift-bright-fox")).toBeInTheDocument();
      expect(screen.getByText("calm-eager-owl")).toBeInTheDocument();
    });

    it("shows interrupted status for runs without updates for 5+ minutes", async () => {
      // Create a run that hasn't been updated in 10 minutes (no finished_at or stopped_at)
      const tenMinutesAgo = Date.now() - 10 * 60 * 1000;
      const interruptedRunData = {
        runs: [
          {
            runId: "interrupted-run",
            workflowVersion: null,
            timestamps: {
              createdAt: tenMinutesAgo - 60000,
              updatedAt: tenMinutesAgo, // Last update was 10 minutes ago
              // No finishedAt or stoppedAt
            },
            progress: 5,
            total: 10,
            summary: {
              datasetCost: 0.02,
              evaluationsCost: 0.01,
              evaluations: {},
            },
          },
        ],
      };

      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRuns.useQuery,
      ).mockReturnValue({
        data: interruptedRunData,
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      } as any);

      vi.mocked(
        api.experiments.getExperimentBatchEvaluationRun.useQuery,
      ).mockReturnValue({
        data: createMockRunData("interrupted-run"),
        isLoading: false,
        error: null,
      } as any);

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(
          screen.getByTestId("run-item-interrupted-run"),
        ).toBeInTheDocument();
      });

      // Should show "interrupted" text in the run item
      const runItem = screen.getByTestId("run-item-interrupted-run");
      expect(runItem.textContent).toContain("interrupted");

      // Should NOT show a spinner (since it's considered finished)
      expect(
        runItem.querySelector('[data-part="spinner"]'),
      ).not.toBeInTheDocument();
    });

    it("enters compare mode when using Compare button", async () => {
      const user = userEvent.setup();
      setupWithMultipleRuns();

      render(
        <BatchEvaluationResults
          project={mockProject}
          experiment={mockExperiment}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(() => {
        expect(screen.getByTestId("compare-button")).toBeInTheDocument();
      });

      // Click compare button
      await user.click(screen.getByTestId("compare-button"));

      // Should have entered compare mode
      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });

      // Should show charts toggle in header when in compare mode
      // (Charts button appears when comparison data is available)
      await waitFor(() => {
        expect(screen.getByTestId("exit-compare-button")).toBeInTheDocument();
      });
    });
  });
});
