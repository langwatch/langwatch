// @vitest-environment jsdom
/**
 * Integration tests for BatchEvaluationResults component
 *
 * These tests verify the full page rendering with mocked API responses,
 * testing the integration between sidebar, table, and summary components.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { BatchEvaluationResults } from "../BatchEvaluationResults";
import type { Project, Experiment } from "@prisma/client";

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
vi.mock("../../../experiments/BatchEvaluationV2/BatchEvaluationV2EvaluationResults", () => ({
  useBatchEvaluationDownloadCSV: vi.fn().mockReturnValue({
    downloadCSV: vi.fn(),
    isDownloadCSVEnabled: true,
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

describe("BatchEvaluationResults Integration", () => {
  const user = userEvent.setup();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state while fetching runs", () => {
    // Mock loading state
    vi.mocked(api.experiments.getExperimentBatchEvaluationRuns.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery>);

    vi.mocked(api.experiments.getExperimentBatchEvaluationRun.useQuery).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<typeof api.experiments.getExperimentBatchEvaluationRun.useQuery>);

    render(
      <BatchEvaluationResults project={mockProject} experiment={mockExperiment} />,
      { wrapper: Wrapper }
    );

    // Should show experiment name
    expect(screen.getByText("Test Experiment")).toBeInTheDocument();
  });

  it("shows empty state when no runs exist", async () => {
    // Mock empty runs
    vi.mocked(api.experiments.getExperimentBatchEvaluationRuns.useQuery).mockReturnValue({
      data: { runs: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery>);

    vi.mocked(api.experiments.getExperimentBatchEvaluationRun.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
    } as unknown as ReturnType<typeof api.experiments.getExperimentBatchEvaluationRun.useQuery>);

    render(
      <BatchEvaluationResults project={mockProject} experiment={mockExperiment} />,
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText("Waiting for results...")).toBeInTheDocument();
    });
  });

  it("shows error state when fetch fails", async () => {
    // Mock error
    vi.mocked(api.experiments.getExperimentBatchEvaluationRuns.useQuery).mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error("Failed to fetch"),
    } as unknown as ReturnType<typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery>);

    render(
      <BatchEvaluationResults project={mockProject} experiment={mockExperiment} />,
      { wrapper: Wrapper }
    );

    await waitFor(() => {
      expect(screen.getByText(/Error loading experiment runs/i)).toBeInTheDocument();
    });
  });
});
