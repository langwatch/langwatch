import { defineSlice } from "@langwatch/browser-host/global-store";
/**
 * @vitest-environment jsdom
 * @see specs/features/suites/{all-runs-panel,all-runs-group-by,suite-bugfixes-1956}.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import {
  RUN_HISTORY_ABSENT,
  RUN_HISTORY_SLICE,
  type RunHistoryState,
} from "@langwatch/suite-contract";
import { Temporal } from "@langwatch/time";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: vi.fn(),
  }),
}));

const mockRunDataQuery = vi.hoisted(() => vi.fn());

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
const mockScenariosQuery = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

// Stands in for suite, the owner of the slice, which this package only reads.
function installRunHistoryStore() {
  defineSlice<RunHistoryState>({
    name: RUN_HISTORY_SLICE,
    create: (set) => ({
      ...RUN_HISTORY_ABSENT,
      setGroupBy: (groupBy) => set({ groupBy }),
      setViewMode: (viewMode) => set({ viewMode }),
      setFilter: (key, value) => set((state) => ({ filters: { ...state.filters, [key]: value } })),
      setFilters: (filters) => set({ filters }),
    }),
  });
}

vi.mock("@langwatch/browser-host/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/browser-host/use-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
    isReady: true,
  }),
}));

vi.mock("../../../../behavior/scenario-api.ts", () => ({
  api: {
    useUtils: () => ({}),
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
  },
}));
vi.mock("@langwatch/prompt-client", () => ({
  promptClient: {
    useUtils: () => ({}),
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
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
        useInfiniteQuery: (input: unknown) => toInfinite(mockRunDataQuery(input)),
      },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
      getAll: { useQuery: mockScenariosQuery },
      cancelJob: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      cancelBatchRun: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      onSimulationUpdate: {},
    },
  },
}));

import type * as actualModule0 from "@langwatch/browser-host/page-visibility";
import type * as actualModule1 from "@langwatch/browser-host/sse-subscription";

import { RunHistoryPanel } from "../run-history-panel.tsx";

const defaultPeriod = {
  startDate: Temporal.Instant.from("2024-01-01T00:00:00Z"),
  endDate: Temporal.Instant.from("2024-12-31T23:59:59Z"),
};

describe("<RunHistoryPanel/> (all-runs view)", () => {
  beforeEach(() => {
    installRunHistoryStore();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given runs exist across suites", () => {
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
      {
        batchRunId: "batch_1",
        scenarioRunId: "run_2",
        scenarioId: "scen_2",
        status: "FAILED",
        timestamp: Date.now(),
        results: null,
        messages: [],
        name: null,
        description: null,
        durationInMs: 200,
      },
    ];

    function renderWithRuns() {
      mockRunDataQuery.mockReturnValue({
        data: {
          runs,
          scenarioSetIds: { batch_1: "__internal__suite_1__suite" },
          hasMore: false,
          changed: true,
        },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      return renderWithDesignSystem(<RunHistoryPanel period={defaultPeriod} />);
    }

    describe("when the panel renders every run type together", () => {
      /** @scenario "Pre-suite scenario runs appear in All Runs" */
      /** @scenario "Suite-created runs still appear in All Runs" */
      /** @scenario "Quick run failure shows toast with drawer link instead of page link" */
      it("renders the All Runs title", () => {
        renderWithRuns();
        expect(screen.getByText("All Runs")).toBeInTheDocument();
      });

      it("displays aggregate passed and failed counts in the header area", () => {
        renderWithRuns();

        const headerTotals = screen.getByTestId("all-runs-header-totals");
        expect(within(headerTotals).getByText("1 passed")).toBeInTheDocument();
        expect(within(headerTotals).getByText("1 failed")).toBeInTheDocument();
      });
    });
  });

  describe("given runs from two scenarios in one suite", () => {
    const runsFromTwoScenarios = [
      {
        batchRunId: "batch_1",
        scenarioRunId: "run_1",
        scenarioId: "scen_1",
        status: "SUCCESS",
        timestamp: 1700000000000,
        results: null,
        messages: [],
        name: "Login Flow",
        description: null,
        durationInMs: 100,
        metadata: { langwatch: { targetReferenceId: "target_a" } },
      },
      {
        batchRunId: "batch_1",
        scenarioRunId: "run_2",
        scenarioId: "scen_2",
        status: "FAILED",
        timestamp: 1700000001000,
        results: null,
        messages: [],
        name: "Checkout Flow",
        description: null,
        durationInMs: 200,
        metadata: { langwatch: { targetReferenceId: "target_b" } },
      },
    ];

    function setupWithRuns() {
      mockRunDataQuery.mockReturnValue({
        data: {
          runs: runsFromTwoScenarios,
          scenarioSetIds: { batch_1: "__internal__suite_1__suite" },
          hasMore: false,
          changed: true,
        },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({
        data: [
          { id: "scen_1", name: "Login Flow" },
          { id: "scen_2", name: "Checkout Flow" },
        ],
      });
    }

    describe("when the panel renders", () => {
      /** @scenario "All Runs page displays group-by selector with correct options and default" */
      /** @scenario "None grouping on All Runs preserves batch run layout" */
      it("renders the group-by selector with None selected by default", () => {
        setupWithRuns();
        renderWithDesignSystem(<RunHistoryPanel period={defaultPeriod} />);

        const groupBySelect = screen.getByLabelText("Group by");
        expect(groupBySelect).toBeInTheDocument();
        expect(groupBySelect).toHaveValue("none");

        const optionValues = Array.from(groupBySelect.querySelectorAll("option")).map(
          (o) => o.value,
        );
        expect(optionValues).toEqual(["none", "scenario", "target"]);
      });
    });
  });

  describe("given runs of one scenario spread over two suites", () => {
    describe("when group-by is changed to Scenario", () => {
      /** @scenario "All run types appear together" */
      /** @scenario "Grouped results include runs from all suites" */
      /** @scenario User groups All Runs results by scenario */
      it("groups runs from every suite under the one scenario", async () => {
        const runsFromTwoSuites = [
          {
            batchRunId: "batch_suite_a",
            scenarioRunId: "run_a1",
            scenarioId: "scen_shared",
            status: "SUCCESS",
            timestamp: 1700000000000,
            results: null,
            messages: [],
            name: "Shared Scenario",
            description: null,
            durationInMs: 100,
          },
          {
            batchRunId: "batch_suite_b",
            scenarioRunId: "run_b1",
            scenarioId: "scen_shared",
            status: "FAILED",
            timestamp: 1700000001000,
            results: null,
            messages: [],
            name: "Shared Scenario",
            description: null,
            durationInMs: 200,
          },
        ];

        mockRunDataQuery.mockReturnValue({
          data: {
            runs: runsFromTwoSuites,
            scenarioSetIds: {
              batch_suite_a: "__internal__suite_a__suite",
              batch_suite_b: "__internal__suite_b__suite",
            },
            hasMore: false,
            changed: true,
          },
          isLoading: false,
          error: null,
        });
        mockScenariosQuery.mockReturnValue({
          data: [{ id: "scen_shared", name: "Shared Scenario" }],
        });

        renderWithDesignSystem(<RunHistoryPanel period={defaultPeriod} />);

        await userEvent.selectOptions(screen.getByLabelText("Group by"), "scenario");

        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(1);
        expect(within(groupHeaders[0]!).getByText("Shared Scenario")).toBeInTheDocument();
      });
    });
  });
});
