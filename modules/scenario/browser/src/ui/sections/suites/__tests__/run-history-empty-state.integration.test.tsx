/**
 * Integration tests for the RunHistoryPanel empty state in the single-suite view.
 * @vitest-environment jsdom
 * @see specs/features/suites/suite-empty-state.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { Temporal } from "@langwatch/time";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSuiteRunData = vi.hoisted(() => vi.fn());

/** A single-page result in the infinite-query shape; one per source, so identity holds. */
const toInfinite = vi.hoisted(() => {
  const cache = new WeakMap<object, unknown>();
  return (result: { data: unknown }) => {
    if (typeof result !== "object" || !result || "fetchNextPage" in result) return result;
    if (!cache.has(result)) {
      cache.set(result, {
        ...result,
        data: { pages: [result.data] },
        hasNextPage: false,
        fetchNextPage: vi.fn(),
        isFetchingNextPage: false,
      });
    }
    return cache.get(result);
  };
});

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

vi.mock("@langwatch/browser-host/page-visibility", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule0>();
  return {
    ...actual,
    usePageVisibility: () => true,
  };
});
vi.mock("@langwatch/browser-host/sse-subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof actualModule1>();
  return {
    ...actual,
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
  };
});

vi.mock("@langwatch/browser-host/drawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), setFlowCallbacks: vi.fn() }),
}));

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({ query: {}, push: vi.fn(), isReady: true }),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    agents: { getAll: { useQuery: vi.fn(() => ({ data: [] })) } },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
  },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({}),
    prompts: { getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) } },
  },
}));

vi.mock("@langwatch/scenario-client", () => ({
  scenarioClient: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn(), setData: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: {
        useInfiniteQuery: (input: unknown) => toInfinite(mockGetSuiteRunData(input)),
      },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
      cancelJob: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      cancelBatchRun: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      onSimulationUpdate: {},
    },
  },
}));

import type * as actualModule0 from "@langwatch/browser-host/page-visibility";
import type * as actualModule1 from "@langwatch/browser-host/sse-subscription";

import { RunHistoryPanel } from "../run-history-panel.tsx";

const widePeriod = {
  startDate: Temporal.Instant.from("2024-01-01T00:00:00Z"),
  endDate: Temporal.Instant.from("2024-12-31T23:59:59Z"),
};

const scenarioSetId = "__internal__suite_1__suite";
const emptyStateCopy = "Run this suite to see results here.";

describe("<RunHistoryPanel/> empty state", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given a suite with no runs", () => {
    beforeEach(() => {
      mockGetSuiteRunData.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
        isLoading: false,
        error: null,
      });
    });

    describe("when the panel renders", () => {
      /** @scenario "Empty state displays when suite has no runs" */
      it("displays an empty state message indicating no runs exist", () => {
        renderWithDesignSystem(
          <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
        );

        expect(screen.getByText(emptyStateCopy)).toBeInTheDocument();
      });
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

    describe("when the panel renders", () => {
      /** @scenario "Empty state disappears when runs exist" */
      it("hides the empty state and shows run results", () => {
        renderWithDesignSystem(
          <RunHistoryPanel scenarioSetId={scenarioSetId} period={widePeriod} />,
        );

        expect(screen.queryByText(emptyStateCopy)).not.toBeInTheDocument();
        expect(screen.getByTestId("run-row-header")).toBeInTheDocument();
      });
    });
  });

  describe("given every run falls outside the selected period", () => {
    beforeEach(() => {
      mockGetSuiteRunData.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
        isLoading: false,
        error: null,
      });
    });

    describe("when the panel renders a narrow period", () => {
      /** @scenario "Empty state does not appear when runs exist but are filtered out" */
      it("shows the empty state for the current period", () => {
        renderWithDesignSystem(
          <RunHistoryPanel
            scenarioSetId={scenarioSetId}
            period={{
              startDate: Temporal.Instant.from("2024-06-01T00:00:00Z"),
              endDate: Temporal.Instant.from("2024-06-30T23:59:59Z"),
            }}
          />,
        );

        expect(screen.getByText(emptyStateCopy)).toBeInTheDocument();
      });
    });
  });
});
