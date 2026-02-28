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

const defaultPeriod = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-12-31T23:59:59Z"),
};

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

      const { container } = render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

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

      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

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

      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

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
          scenarioSetIds: { batch_1: "__internal__suite_1__suite" },
          hasMore: false,
        },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

      expect(screen.getByText("All Runs")).toBeInTheDocument();
    });
  });

  describe("when the period changes", () => {
    it("passes startDate and endDate to the query", () => {
      const period = {
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };

      mockSuitesQuery.mockReturnValue({ data: [] });
      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<AllRunsPanel period={period} />, { wrapper: Wrapper });

      expect(mockRunDataQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          startDate: period.startDate.getTime(),
          endDate: period.endDate.getTime(),
        }),
        expect.anything(),
      );
    });

    it("resets pagination when re-rendered with a new period", () => {
      const period1 = {
        startDate: new Date("2024-01-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };
      const period2 = {
        startDate: new Date("2024-07-01T00:00:00Z"),
        endDate: new Date("2024-12-31T23:59:59Z"),
      };

      mockSuitesQuery.mockReturnValue({ data: [] });
      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      const { rerender } = render(<AllRunsPanel period={period1} />, { wrapper: Wrapper });

      // Re-render with a different period
      rerender(
        <Wrapper>
          <AllRunsPanel period={period2} />
        </Wrapper>,
      );

      // The latest call uses the new period dates (pagination was reset)
      const lastCall = mockRunDataQuery.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0]).toMatchObject({
        startDate: period2.startDate.getTime(),
        endDate: period2.endDate.getTime(),
        cursor: undefined,
      });
    });
  });
});
