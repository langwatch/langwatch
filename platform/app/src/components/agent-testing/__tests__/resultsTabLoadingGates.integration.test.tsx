/**
 * @vitest-environment jsdom
 *
 * How the Results tab reads while a run plan is on its way in. The empty
 * "no plans yet" state is reserved for `!isLoading && !hasAnyPlans`. Between
 * "the URL names a plan" and "the plan record is in the store" the tab reads
 * as a skeleton, not as the plans list, and not as an empty state.
 *
 * @see specs/features/agent-testing/results-tabs.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
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
      getAll: { useQuery: mockSuitesGetAll },
      getSummaries: { useQuery: mockSuiteSummaries },
      getById: { useQuery: () => ({ data: undefined }) },
    },
    scenarios: {
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  /** @scenario A plan opened on a hard reload never flashes a not-found state */
  it("reads as a skeleton while the plan record is still on its way", () => {
    // The URL names a plan the store does not know yet, so `selectedPlan` is
    // null. While ANY query behind the plans read is loading, the tab must
    // read as a skeleton, not as the plans list and not as its empty state.
    mockSuitesGetAll.mockReturnValue({ data: undefined, isLoading: true });

    render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

    expect(
      screen.getByTestId("agent-testing-run-plan-loading"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("agent-testing-run-plans-table"),
    ).not.toBeInTheDocument();
  });

  /** @scenario The plans list shows on its own once every plans query settles */
  it("reads as the plans list once the queries settle and the plan does not exist", () => {
    // Every query has finished; the plan named in the URL is not in the list.
    // With no loading in flight, the fall-through is the plans list, not the
    // loading skeleton.
    mockSuitesGetAll.mockReturnValue({ data: [], isLoading: false });

    render(<ResultsTab isSseConnected />, { wrapper: Wrapper });

    expect(
      screen.queryByTestId("agent-testing-run-plan-loading"),
    ).not.toBeInTheDocument();
    // With no plans, the empty state reads on the tab; it never flashes
    // between the skeleton and the plan record.
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
  });
});
