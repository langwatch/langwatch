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

// The empty states carry the Setup via Agent menu, whose langy hooks need
// app context these tests do not build; the control has its own tests.
vi.mock("~/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

import { RunHistoryPanel } from "../RunHistoryPanel";

// Hoisted mocks
const mockGetSuiteRunData = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockGetSuiteRunData },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
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
    export: {
      onScenarioRunExportProgress: { useSubscription: vi.fn() },
    },
  },
}));

vi.mock("~/hooks/useSSESubscription", () => ({
  useSSESubscription: vi.fn(() => ({
    connectionState: "disconnected",
    isConnected: false,
    isConnecting: false,
    hasError: false,
    isDisconnected: true,
    retryCount: 0,
    lastData: undefined,
    lastError: undefined,
  })),
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

    /** @scenario "Empty state displays when suite has no runs" */
    it("displays an empty state message indicating no runs exist", () => {
      render(
        <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Run this suite to see results here."),
      ).toBeInTheDocument();
    });

    /**
     * Exporting here would write a header and no rows, which reads as a broken
     * export rather than an empty one. Asserted against the panel rather than
     * the filter bar on its own, because the panel is what decides — the bar
     * only renders the flag it is handed.
     */
    /** @scenario Export is unavailable when no runs match */
    it("disables Export CSV rather than offering a header-only file", () => {
      render(
        <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByRole("button", { name: /export csv/i }),
      ).toBeDisabled();
    });
  });

  describe("given no runs on the loaded pages but more still to fetch", () => {
    /**
     * The loaded pages are not the whole history. Filter to a scenario whose
     * runs sit further back and the fetched pages hold none of them, while the
     * server-side sweep would return every one — so a zero count here means
     * "not yet" rather than "none", and disabling the export would refuse a
     * request that would have produced a file.
     */
    it("keeps Export CSV enabled, because the sweep may still match", () => {
      mockGetSuiteRunData.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: true, changed: true },
        isLoading: false,
        error: null,
      });

      render(
        <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
        { wrapper: Wrapper },
      );

      expect(screen.getByRole("button", { name: /export csv/i })).toBeEnabled();
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

    /** @scenario "Empty state disappears when runs exist" */
    it("does not display the empty state and shows run results", () => {
      render(
        <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
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

    /** @scenario "Empty state does not appear when runs exist but are filtered out" */
    it("shows the empty state for current period", () => {
      const narrowPeriod = {
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };

      render(
        <RunHistoryPanel scenarioSetId={scenarioSetId} period={narrowPeriod} />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("Run this suite to see results here."),
      ).toBeInTheDocument();
    });
  });
});
