/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunHistoryPanel empty states.
 *
 * @see specs/features/suites/suite-empty-state.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunHistoryPanel } from "../RunHistoryPanel";

// Hoisted mocks
const mockGetSuiteRunData = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      scenarios: { getScenarioSetBatchHistory: { invalidate: vi.fn() } },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockGetSuiteRunData },
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
      cancelJob: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
      cancelBatchRun: {
        useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })),
      },
    },
    agents: {
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
  },
}));

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: vi.fn(),
}));

vi.mock("~/hooks/usePageVisibility", () => ({
  usePageVisibility: () => true,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    isReady: true,
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
}));

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: vi.fn(),
}));

vi.mock("~/hooks/usePageVisibility", () => ({
  usePageVisibility: () => true,
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const widePeriod = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-12-31T23:59:59Z"),
};

const scenarioSetId = "__internal__suite_1__suite";

describe("<RunHistoryPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a suite with no runs", () => {
    beforeEach(() => {
      mockGetSuiteRunData.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
        isLoading: false,
        error: null,
      });
    });

    it("displays an empty state message indicating no runs exist", () => {
      render(
        <RunHistoryPanel
          scenarioSetId={scenarioSetId}
          period={widePeriod}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Run this suite to see results here."),
      ).toBeInTheDocument();
    });
  });

  describe("given a suite with at least one run", () => {
    beforeEach(() => {
      mockGetSuiteRunData.mockReturnValue({
        data: {
          runs: [
            {
              scenarioRunId: "run_1",
              scenarioId: "scen_1",
              batchRunId: "batch_1",
              timestamp: new Date("2024-06-15T12:00:00Z").getTime(),
              status: "SUCCESS",
              results: null,
              messages: [],
              metadata: {},
              name: null,
              description: null,
              durationInMs: 0,
            },
          ],
          scenarioSetIds: { batch_1: scenarioSetId },
          hasMore: false,
          changed: true,
        },
        isLoading: false,
        error: null,
      });
    });

    it("does not display the empty state and shows run results", () => {
      render(
        <RunHistoryPanel
          scenarioSetId={scenarioSetId}
          period={widePeriod}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.queryByText("Run this suite to see results here."),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("run-row-header")).toBeInTheDocument();
    });
  });

  describe("given a suite with runs outside the selected time period", () => {
    beforeEach(() => {
      mockGetSuiteRunData.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
        isLoading: false,
        error: null,
      });
    });

    it("shows the empty state for current period", () => {
      const narrowPeriod = {
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };

      render(
        <RunHistoryPanel
          scenarioSetId={scenarioSetId}
          period={narrowPeriod}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Run this suite to see results here."),
      ).toBeInTheDocument();
    });
  });
});
