// @vitest-environment jsdom
/**
 * Tests for HistoryButton component
 *
 * Verifies that:
 * 1. The button uses experimentId (not slug) to fetch runs
 * 2. It shows "No runs yet" when no runs exist
 * 3. It enables and shows correct tooltip when runs exist
 * 4. It navigates to the correct experiment page
 */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HistoryButton } from "../HistoryButton";

// Mock the API
vi.mock("~/utils/api", () => ({
  api: {
    experiments: {
      getExperimentBatchEvaluationRuns: {
        useQuery: vi.fn(),
      },
    },
  },
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: vi.fn(),
}));

// Mock useEvaluationsV3Store with dynamic return values
let mockStoreValues = {
  experimentId: null as string | null,
  experimentSlug: null as string | null,
};
vi.mock("~/evaluations-v3/hooks/useEvaluationsV3Store", () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useEvaluationsV3Store: vi.fn((selector: (state: any) => unknown) =>
    selector(mockStoreValues),
  ),
}));

import { useEvaluationsV3Store } from "~/evaluations-v3/hooks/useEvaluationsV3Store";

// Mock next/router
const mockPush = vi.fn();
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockPush,
    query: { slug: "test-slug" },
  }),
}));

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
// Import the mocked modules
import { api } from "~/utils/api";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("HistoryButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset store values
    mockStoreValues = {
      experimentId: null,
      experimentSlug: null,
    };

    // Default mock for project
    vi.mocked(useOrganizationTeamProject).mockReturnValue({
      project: { id: "project-123", slug: "test-project" },
    } as ReturnType<typeof useOrganizationTeamProject>);

    // Update useEvaluationsV3Store mock to use fresh values
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEvaluationsV3Store).mockImplementation(
      (selector: (state: any) => unknown) => selector(mockStoreValues),
    );
  });

  afterEach(() => {
    cleanup();
  });

  it("uses experimentId (not slug) to query for runs", () => {
    // Set mock store values
    mockStoreValues.experimentId = "exp-actual-id-123";
    mockStoreValues.experimentSlug = "test-slug";

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

    render(<HistoryButton />, { wrapper: Wrapper });

    // Verify the query was called with experimentId, NOT the slug
    expect(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).toHaveBeenCalledWith(
      {
        projectId: "project-123",
        experimentId: "exp-actual-id-123", // Should use actual ID
      },
      expect.objectContaining({
        enabled: true,
      }),
    );
  });

  it("shows disabled button with 'No runs yet' tooltip when no runs exist", async () => {
    mockStoreValues.experimentId = "exp-123";
    mockStoreValues.experimentSlug = "test-slug";

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: { runs: [] },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    render(<HistoryButton />, { wrapper: Wrapper });

    // Component is now a link element
    const historyLink = screen.getByRole("link", { name: "View run history" });
    expect(historyLink).toHaveAttribute("disabled");
  });

  it("shows enabled button when runs exist", async () => {
    mockStoreValues.experimentId = "exp-123";
    mockStoreValues.experimentSlug = "test-slug";

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: {
        runs: [
          {
            run_id: "run-1",
            timestamps: { created_at: Date.now(), finished_at: Date.now() },
            summary: { evaluations: {} },
          },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    render(<HistoryButton />, { wrapper: Wrapper });

    // Component is now a link element
    const historyLink = screen.getByRole("link", { name: "View run history" });
    expect(historyLink).not.toHaveAttribute("disabled");
  });

  it("navigates to experiment page using experimentSlug from store when clicked", async () => {
    // Update the mock to return specific values for this test
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(useEvaluationsV3Store).mockImplementation(
      (selector: (state: any) => unknown) =>
        selector({
          experimentId: "exp-123",
          experimentSlug: "my-custom-slug",
        }),
    );

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: {
        runs: [
          {
            run_id: "run-1",
            timestamps: { created_at: Date.now() },
            summary: { evaluations: {} },
          },
        ],
      },
      isLoading: false,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    render(<HistoryButton />, { wrapper: Wrapper });

    // Component is now a link element - verify href instead of onClick navigation
    const historyLink = screen.getByRole("link", { name: "View run history" });
    expect(historyLink).toHaveAttribute(
      "href",
      "/test-project/experiments/my-custom-slug",
    );
  });

  it("does not render when experimentId is not set", () => {
    mockStoreValues.experimentId = null;
    mockStoreValues.experimentSlug = "test-slug";

    const { container } = render(<HistoryButton />, { wrapper: Wrapper });
    expect(container.firstChild).toBeNull();
  });

  it("shows disabled button while loading", () => {
    mockStoreValues.experimentId = "exp-123";
    mockStoreValues.experimentSlug = "test-slug";

    vi.mocked(
      api.experiments.getExperimentBatchEvaluationRuns.useQuery,
    ).mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    } as unknown as ReturnType<
      typeof api.experiments.getExperimentBatchEvaluationRuns.useQuery
    >);

    render(<HistoryButton />, { wrapper: Wrapper });

    // Component is now a link element
    const historyLink = screen.getByRole("link", { name: "View run history" });
    expect(historyLink).toHaveAttribute("disabled");
  });
});
