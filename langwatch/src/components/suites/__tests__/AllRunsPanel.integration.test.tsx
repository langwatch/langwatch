/**
 * @vitest-environment jsdom
 *
 * Integration tests for AllRunsPanel component.
 *
 * Tests cross-suite run history rendering, empty states, and error handling.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AllRunsPanel } from "../AllRunsPanel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Hoisted mocks
const mockSuitesQuery = vi.hoisted(() => vi.fn());
const mockRunDataQuery = vi.hoisted(() => vi.fn());
const mockScenariosQuery = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

// Mock the hooks and API
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    suites: {
      getAll: {
        useQuery: mockSuitesQuery,
      },
    },
    scenarios: {
      getAllSuiteRunData: {
        useQuery: mockRunDataQuery,
      },
      getAll: {
        useQuery: mockScenariosQuery,
      },
    },
  },
}));

describe("<AllRunsPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given loading state", () => {
    it("displays loading spinner", () => {
      mockSuitesQuery.mockReturnValue({ data: undefined });
      mockRunDataQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: undefined });

      const { container } = render(<AllRunsPanel />, { wrapper: Wrapper });

      // Check for spinner element
      expect(container.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });

  describe("given error state", () => {
    it("displays error message", () => {
      mockSuitesQuery.mockReturnValue({ data: [] });
      mockRunDataQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { message: "Network error" },
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<AllRunsPanel />, { wrapper: Wrapper });

      expect(screen.getByText(/Error loading runs/i)).toBeInTheDocument();
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  describe("given no runs exist", () => {
    it("displays empty state message", () => {
      mockSuitesQuery.mockReturnValue({ data: [] });
      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<AllRunsPanel />, { wrapper: Wrapper });

      expect(
        screen.getByText(/No runs yet. Execute a suite to see results here./i),
      ).toBeInTheDocument();
    });
  });

  describe("given runs exist", () => {
    it("renders All Runs title", () => {
      const runs = [
        {
          batchRunId: "batch_1",
          scenarioRunId: "run_1",
          scenarioId: "scen_1",
          status: "SUCCESS",
          timestamp: Date.now(),
          results: null,
          messages: [],
          name: null,
          description: null,
          durationInMs: 100,
        },
      ];

      mockSuitesQuery.mockReturnValue({ data: [] });
      mockRunDataQuery.mockReturnValue({
        data: {
          runs,
          scenarioSetIds: { batch_1: "__suite__suite_1" },
          hasMore: false,
        },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<AllRunsPanel />, { wrapper: Wrapper });

      expect(screen.getByText("All Runs")).toBeInTheDocument();
    });
  });
});
