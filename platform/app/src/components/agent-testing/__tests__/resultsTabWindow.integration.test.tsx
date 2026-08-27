/**
 * @vitest-environment jsdom
 *
 * The window the Results tab reads, and what happens when the run being
 * opened is older than it.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsTab } from "../results/ResultsTab";

const mockRouterPush = vi.hoisted(() => vi.fn());
const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string | string[] | undefined>,
  asPath: "/test-project/agent-testing/results",
}));

const mockSuitesGetAll = vi.hoisted(() => vi.fn());
const mockSuiteSummaries = vi.hoisted(() => vi.fn());

/**
 * The query results are built once. The pagination hook accumulates pages on
 * the identity of its result, so a fresh object per render never settles.
 */
const emptyResults = vi.hoisted(() => ({
  externalSets: { data: [] as unknown[] },
  batchHistory: { data: { batches: [] as unknown[] } },
  runData: {
    data: { runs: [], scenarioSetIds: {}, hasMore: false, changed: true },
    isLoading: false,
    error: null,
    refetch: () => undefined,
  },
  freshness: { data: undefined },
  batchCount: { data: { count: 0 } },
  list: { data: [] as unknown[] },
  overview: {
    data: {
      totals: {
        executions: 0,
        runCount: 0,
        passRate: null,
        failingScenarios: 0,
        cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
        series: [] as unknown[],
      },
      groups: [] as unknown[],
    },
    isLoading: false,
  },
  atoms: { data: { atoms: [] as unknown[], hasMore: false }, isLoading: false },
}));

vi.mock("~/utils/api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn() },
      },
    }),
    suites: {
      // Every run of the v2 dialog is queued under a plan name.
      runPlan: {
        useMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
      },
      getAll: { useQuery: mockSuitesGetAll },
      getSummaries: { useQuery: mockSuiteSummaries },
      getById: { useQuery: () => ({ data: undefined }) },
      // The row menu of a run plan archives it, through the suite call for a
      // plan and the folder call for a test suite.
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      folders: {
        archive: {
          useMutation: () => ({ mutate: vi.fn(), isPending: false }),
        },
      },
    },
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      // The results list names the scenario and the labels of every run it
      // lists, so the tab reads the scenarios of the project too.
      getAll: { useQuery: () => ({ data: [] }) },
      getResultsOverview: { useQuery: () => emptyResults.overview },
      getResultAtoms: { useQuery: () => emptyResults.atoms },
      getExternalSetSummaries: {
        useQuery: () => emptyResults.externalSets,
      },
      getScenarioSetBatchHistory: {
        useQuery: () => emptyResults.batchHistory,
      },
      getSuiteRunData: { useQuery: () => emptyResults.runData },
      getSuiteRunFreshness: { useQuery: () => emptyResults.freshness },
      getScenarioSetBatchRunCount: {
        useQuery: () => emptyResults.batchCount,
      },
      cancelJob: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    agents: { getAll: { useQuery: () => emptyResults.list } },
    prompts: {
      getAllPromptsForProject: { useQuery: () => emptyResults.list },
    },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
    // The settings row names whoever started a run from the organization
    // roster, so the column reads this even when no run names a person.
    organization: {
      getOrganizationWithMembersAndTheirTeams: {
        useQuery: () => ({ data: undefined }),
      },
    },
  },
}));

vi.mock("~/hooks/useCan", () => ({
  useCan: () => ({ can: () => true, isLoading: false, permissions: [] }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({ openDrawer: vi.fn(), setFlowCallbacks: vi.fn() }),
}));

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({
    query: routerState.query,
    asPath: routerState.asPath,
    push: mockRouterPush,
    isReady: true,
  }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: () => "2h ago",
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const DAY_MS = 86_400_000;

describe("the window the Results tab reads", () => {
  beforeEach(() => {
    routerState.query = {
      project: "test-project",
      path: ["results", "checkout"],
    };
    routerState.asPath = "/test-project/agent-testing/results/checkout";
    mockSuitesGetAll.mockReturnValue({
      data: [
        {
          id: "suite_1",
          name: "Checkout",
          slug: "checkout",
          scenarioIds: ["scen_1"],
          labels: [],
        },
      ],
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** @scenario "The period widens on its own when the last run is older than the window" */
  it("widens the period until the last run is inside it", () => {
    const lastRun = Date.now() - 60 * DAY_MS;
    mockSuiteSummaries.mockReturnValue({
      data: {
        suite_1: {
          passedCount: 1,
          failedCount: 0,
          totalCount: 1,
          lastRunTimestamp: lastRun,
        },
      },
    });

    render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

    const push = mockRouterPush.mock.calls.find(
      (call) =>
        (call[0] as { query?: Record<string, string> }).query?.startDate,
    );
    expect(push).toBeDefined();
    const query = (push![0] as { query: Record<string, string> }).query;
    expect(new Date(query.startDate!).getTime()).toBeLessThanOrEqual(lastRun);
    // The picker reads the widened window from the same address params.
    expect(query.endDate).toBeDefined();
  });

  it("leaves the period alone when the last run is inside it", () => {
    mockSuiteSummaries.mockReturnValue({
      data: {
        suite_1: {
          passedCount: 1,
          failedCount: 0,
          totalCount: 1,
          lastRunTimestamp: Date.now() - DAY_MS,
        },
      },
    });

    render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

    expect(
      mockRouterPush.mock.calls.filter(
        (call) =>
          (call[0] as { query?: Record<string, string> }).query?.startDate,
      ),
    ).toHaveLength(0);
  });

  it("opens on the list of run plans when the address names none", () => {
    routerState.query = { project: "test-project", path: ["results"] };
    routerState.asPath = "/test-project/agent-testing/results";
    mockSuiteSummaries.mockReturnValue({ data: {} });

    render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

    expect(screen.getByTestId("agent-testing-run-plans")).toBeInTheDocument();
    expect(screen.getByText("Test Runs")).toBeInTheDocument();
  });
});
