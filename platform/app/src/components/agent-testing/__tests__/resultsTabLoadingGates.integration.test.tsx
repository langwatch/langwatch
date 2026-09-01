/**
 * @vitest-environment jsdom
 *
 * How the Results tab reads while a run plan is on its way in, and which
 * stored rows reach the list. The empty "no plans yet" state is reserved for
 * `!isLoading && !hasAnyPlans`. Between "the URL names a plan" and "the plan
 * record is in the store" the tab reads as a skeleton, not as the plans list,
 * and not as an empty state.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import type React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ResultsTab } from "../results/ResultsTab";

const routerState = vi.hoisted(() => ({
  query: {} as Record<string, string | string[] | undefined>,
  asPath: "/test-project/agent-testing/results/checkout",
}));

const mockSuitesGetAll = vi.hoisted(() => vi.fn());
const mockSuiteSummaries = vi.hoisted(() => vi.fn());
const mockExternalSets = vi.hoisted(() => vi.fn());
const mockBatchHistory = vi.hoisted(() => vi.fn());

const mockResultsOverview = vi.hoisted(() => vi.fn());
const mockResultAtoms = vi.hoisted(() => vi.fn());

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
      // The row menu of a run plan archives it. Every row is a stored plan,
      // so there is one call and no test suite branch.
      archive: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
    },
    scenarios: {
      // The run dialog reads the configurations its scope already ran with.
      getRunConfigurations: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      // The results list names the scenario and the labels of every run it
      // lists, so the tab reads the scenarios of the project too.
      getAll: { useQuery: () => ({ data: [] }) },
      getCodeScenarios: { useQuery: () => ({ data: [] }) },
      getRunTargets: { useQuery: () => ({ data: [] }) },
      getResultsOverview: { useQuery: mockResultsOverview },
      getResultAtoms: { useQuery: mockResultAtoms },
      getExternalSetSummaries: { useQuery: mockExternalSets },
      getScenarioSetBatchHistory: { useQuery: mockBatchHistory },
      getSuiteRunData: {
        useQuery: () => ({
          data: undefined,
          isLoading: false,
          error: null,
          refetch: () => undefined,
        }),
      },
      getSuiteRunFreshness: { useQuery: () => ({ data: undefined }) },
      getScenarioSetBatchRunCount: { useQuery: () => ({ data: { count: 0 } }) },
      cancelJob: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      cancelBatchRun: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: {
      getAllPromptsForProject: { useQuery: () => ({ data: [] }) },
    },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
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
    push: vi.fn(),
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("the Results tab loading gate", () => {
  beforeEach(() => {
    routerState.query = {
      project: "test-project",
      path: ["results", "checkout"],
    };
    routerState.asPath = "/test-project/agent-testing/results/checkout";
    mockExternalSets.mockReturnValue({ data: [], isLoading: false });
    mockBatchHistory.mockReturnValue({
      data: { batches: [] },
      isLoading: false,
    });
    mockSuiteSummaries.mockReturnValue({ data: {}, isLoading: false });
    mockResultsOverview.mockReturnValue({
      data: {
        totals: {
          executions: 0,
          runCount: 0,
          passRate: null,
          failingScenarios: 0,
          cost: { totalUsd: 0, knownAtoms: 0, unknownAtoms: 0 },
          series: [],
        },
        groups: [],
      },
      isLoading: false,
    });
    mockResultAtoms.mockReturnValue({
      data: { atoms: [], hasMore: false },
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given the project holds a test suite and a plan scoped to it", () => {
    describe("when the Test Runs list is read", () => {
      /** @scenario "The Test Runs list holds one row for every run plan" */
      it("lists the plan alone and names the test suite in its scope", () => {
        routerState.query = { project: "test-project", path: ["results"] };
        routerState.asPath = "/test-project/agent-testing/results";
        mockSuitesGetAll.mockReturnValue({
          data: [
            {
              id: "test_suite_checkout",
              name: "Checkout",
              slug: "checkout",
              scenarioIds: ["scen_1"],
              labels: [],
              kind: "test_suite",
              scope: null,
            },
            {
              id: "plan_nightly",
              name: "Nightly checkout",
              slug: "nightly-checkout",
              scenarioIds: [],
              labels: [],
              kind: "run_plan",
              scope: {
                mode: "test_suites",
                testSuiteIds: ["test_suite_checkout"],
              },
            },
          ],
          isLoading: false,
        });

        render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

        // The test suite is a group of scenarios, so it is no row of its own.
        expect(
          screen.getByTestId("run-plan-row-nightly-checkout"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("run-plan-row-checkout"),
        ).not.toBeInTheDocument();

        // Its name still reaches the list, as the scope of the plan that runs it.
        expect(
          within(screen.getByTestId("run-plan-row-nightly-checkout")).getByText(
            "Checkout",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given the URL names a plan the store does not know yet", () => {
    describe("when any query behind the plans read is still loading", () => {
      /** @scenario A plan opened on a hard reload never flashes a not-found state */
      it("reads as a skeleton, not as the plans list nor its empty state", () => {
        mockSuitesGetAll.mockReturnValue({ data: undefined, isLoading: true });

        render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

        expect(
          screen.getByTestId("agent-testing-run-plan-loading"),
        ).toBeInTheDocument();
        expect(
          screen.queryByTestId("agent-testing-run-plans-table"),
        ).not.toBeInTheDocument();
        expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
      });
    });

    describe("when every plans query has settled and the plan is not in the list", () => {
      /** @scenario The plans list shows on its own once every plans query settles */
      it("reads as the plans list empty state, never as the loading skeleton", () => {
        mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });

        render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

        expect(
          screen.queryByTestId("agent-testing-run-plan-loading"),
        ).not.toBeInTheDocument();
        expect(screen.getByText("No runs yet")).toBeInTheDocument();
      });
    });
  });
});
