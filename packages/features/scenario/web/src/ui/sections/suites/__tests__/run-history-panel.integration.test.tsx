/**
 * @vitest-environment jsdom
 *
 * Integration tests for the cross-suite ("All Runs") view of RunHistoryPanel.
 *
 * @see specs/features/suites/all-runs-panel.feature
 * @see specs/features/suites/all-runs-group-by.feature
 * @see specs/features/suites/suite-bugfixes-1956.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: { capture: vi.fn() },
}));

// The empty states carry the Setup via Agent menu, whose langy hooks need
// app context these tests do not build; the control has its own tests.
vi.mock("@langwatch/trace-web/components/SetupWithAgentButton", () => ({
  SetupWithAgentButton: () => null,
}));

vi.mock("@langwatch/trace-web/hooks/usePageVisibility", () => ({
  usePageVisibility: () => true,
}));

vi.mock("@langwatch/trace-web/hooks/useSSESubscription", () => ({
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

vi.mock("@langwatch/ui-drawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
    setFlowCallbacks: vi.fn(),
  }),
}));

const mockRunDataQuery = vi.hoisted(() => vi.fn());
const mockScenariosQuery = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock("../../../../behavior/use-organization-team-project", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
    hasAnyPermission: () => true,
    isLoading: false,
  }),
}));

vi.mock("@langwatch/ui-host/use-router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
    isReady: true,
  }),
}));

vi.mock("../../../../behavior/scenario-api", () => ({
  api: {
    useUtils: () => ({
      scenarios: {
        getSuiteRunData: { invalidate: vi.fn() },
        getRunState: { invalidate: vi.fn(), prefetch: vi.fn(), setData: vi.fn() },
        getScenarioSetBatchHistory: { invalidate: vi.fn() },
      },
    }),
    scenarios: {
      getSuiteRunData: { useQuery: mockRunDataQuery },
      getSuiteRunFreshness: { useQuery: vi.fn(() => ({ data: undefined })) },
      getAll: { useQuery: mockScenariosQuery },
      cancelJob: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      cancelBatchRun: { useMutation: vi.fn(() => ({ mutate: vi.fn(), isPending: false })) },
      onSimulationUpdate: {},
    },
    agents: { getAll: { useQuery: () => ({ data: [] }) } },
    prompts: { getAllPromptsForProject: { useQuery: () => ({ data: [] }) } },
    export: { onScenarioRunExportProgress: { useSubscription: vi.fn() } },
  },
}));

import { RunHistoryPanel } from "../run-history-panel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const defaultPeriod = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-12-31T23:59:59Z"),
};

describe("<RunHistoryPanel/> (all-runs view)", () => {
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

      return render(<RunHistoryPanel period={defaultPeriod} />, {
        wrapper: Wrapper,
      });
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
        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

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

        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        await userEvent.selectOptions(screen.getByLabelText("Group by"), "scenario");

        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(1);
        expect(within(groupHeaders[0]!).getByText("Shared Scenario")).toBeInTheDocument();
      });
    });
  });
});
