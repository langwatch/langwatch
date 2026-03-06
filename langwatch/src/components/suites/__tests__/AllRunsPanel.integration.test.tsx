/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunHistoryPanel component (cross-suite / all-runs view).
 *
 * Tests cross-suite run history rendering, empty states, and error handling.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunHistoryPanel } from "../RunHistoryPanel";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

// Hoisted mocks
const mockRunDataQuery = vi.hoisted(() => vi.fn());
const mockScenariosQuery = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: vi.fn(),
  }),
}));

// Mock the hooks and API
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    push: mockRouterPush,
    query: {},
    isReady: true,
  }),
}));

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getSuiteRunData: {
        useQuery: mockRunDataQuery,
      },
      getAll: {
        useQuery: mockScenariosQuery,
      },
    },
    agents: {
      getAll: {
        useQuery: () => ({ data: [] }),
      },
    },
    prompts: {
      getAllPromptsForProject: {
        useQuery: () => ({ data: [] }),
      },
    },
  },
}));

const defaultPeriod = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-12-31T23:59:59Z"),
};

describe("<RunHistoryPanel/> (all-runs view)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given loading state", () => {
    it("displays loading spinner", () => {
      mockRunDataQuery.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: undefined });

      const { container } = render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

      // Chakra Spinner renders as a span with class containing "spinner"
      expect(container.querySelector(".chakra-spinner")).toBeInTheDocument();
    });
  });

  describe("given error state", () => {
    it("displays error message", () => {
      mockRunDataQuery.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: { message: "Network error" },
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

      expect(screen.getByText(/Error loading runs/i)).toBeInTheDocument();
      expect(screen.getByText(/Network error/i)).toBeInTheDocument();
    });
  });

  describe("given no runs exist", () => {
    it("displays empty state message", () => {
      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

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

      render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

      expect(screen.getByText("All Runs")).toBeInTheDocument();
    });
  });

  describe("when the period changes", () => {
    it("passes startDate and endDate to the query", () => {
      const period = {
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };

      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      render(<RunHistoryPanel period={period} />, { wrapper: Wrapper });

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

      mockRunDataQuery.mockReturnValue({
        data: { runs: [], scenarioSetIds: {}, hasMore: false },
        isLoading: false,
        error: null,
      });
      mockScenariosQuery.mockReturnValue({ data: [] });

      const { rerender } = render(<RunHistoryPanel period={period1} />, { wrapper: Wrapper });

      // Re-render with a different period
      rerender(
        <Wrapper>
          <RunHistoryPanel period={period2} />
        </Wrapper>,
      );

      // The latest call uses the new period dates (pagination was reset)
      const lastCall = mockRunDataQuery.mock.calls.at(-1);
      expect(lastCall).toBeDefined();
      expect(lastCall![0]).toMatchObject({
        startDate: period2.startDate.getTime(),
        endDate: period2.endDate.getTime(),
      });
    });
  });

  describe("group-by selector", () => {
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
      it("renders the group-by selector with None selected by default", () => {
        setupWithRuns();
        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        expect(groupBySelect).toBeInTheDocument();
        expect(groupBySelect).toHaveValue("none");
      });

      it("has None, Scenario, and Target options", () => {
        setupWithRuns();
        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        const options = groupBySelect.querySelectorAll("option");
        const optionValues = Array.from(options).map((o) => o.value);

        expect(optionValues).toEqual(["none", "scenario", "target"]);
      });
    });

    describe("when group-by is changed to Scenario", () => {
      it("renders group row headers instead of batch run rows", async () => {
        setupWithRuns();
        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        await userEvent.selectOptions(groupBySelect, "scenario");

        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(2);

        // Verify scenario names appear as group labels (may also appear in filter dropdown)
        expect(screen.getAllByText("Login Flow").length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText("Checkout Flow").length).toBeGreaterThanOrEqual(1);
      });

      it("includes runs from multiple suites in grouped results", async () => {
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
          },
          isLoading: false,
          error: null,
        });
        mockScenariosQuery.mockReturnValue({
          data: [{ id: "scen_shared", name: "Shared Scenario" }],
        });

        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        await userEvent.selectOptions(groupBySelect, "scenario");

        // Both runs from different suites should be grouped under one scenario
        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(1);
        expect(screen.getAllByText("Shared Scenario").length).toBeGreaterThanOrEqual(1);
      });
    });

    describe("when group-by is changed to Target", () => {
      it("renders target group headers", async () => {
        // Use runs with same scenario but different targets so grouping by
        // target produces a different count than grouping by scenario
        const runsSameScenarioDifferentTargets = [
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
            scenarioId: "scen_1",
            status: "FAILED",
            timestamp: 1700000001000,
            results: null,
            messages: [],
            name: "Login Flow",
            description: null,
            durationInMs: 200,
            metadata: { langwatch: { targetReferenceId: "target_b" } },
          },
        ];
        mockRunDataQuery.mockReturnValue({
          data: {
            runs: runsSameScenarioDifferentTargets,
            scenarioSetIds: { batch_1: "__internal__suite_1__suite" },
            hasMore: false,
          },
          isLoading: false,
          error: null,
        });
        mockScenariosQuery.mockReturnValue({
          data: [{ id: "scen_1", name: "Login Flow" }],
        });

        render(<RunHistoryPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        await userEvent.selectOptions(groupBySelect, "target");

        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(2);
      });
    });
  });
});
