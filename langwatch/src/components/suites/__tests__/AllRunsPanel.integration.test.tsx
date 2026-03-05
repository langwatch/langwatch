/**
 * @vitest-environment jsdom
 *
 * Integration tests for AllRunsPanel component.
 *
 * Tests cross-suite run history rendering, empty states, and error handling.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

      expect(screen.getByRole("status")).toBeInTheDocument();
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
      mockSuitesQuery.mockReturnValue({ data: [] });
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

    it("renders the group-by selector with None selected by default", () => {
      setupWithRuns();
      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

      const groupBySelect = screen.getByLabelText("Group by");
      expect(groupBySelect).toBeInTheDocument();
      expect(groupBySelect).toHaveValue("none");
    });

    it("has None, Scenario, and Target options", () => {
      setupWithRuns();
      render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

      const groupBySelect = screen.getByLabelText("Group by");
      const options = groupBySelect.querySelectorAll("option");
      const optionValues = Array.from(options).map((o) => o.value);

      expect(optionValues).toEqual(["none", "scenario", "target"]);
    });

    describe("when group-by is changed to Scenario", () => {
      it("renders group row headers instead of batch run rows", async () => {
        setupWithRuns();
        render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        await userEvent.selectOptions(groupBySelect, "scenario");

        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(2);

        // Verify scenario names appear as group labels
        expect(screen.getByText("Login Flow")).toBeInTheDocument();
        expect(screen.getByText("Checkout Flow")).toBeInTheDocument();
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

        mockSuitesQuery.mockReturnValue({
          data: [
            { id: "suite_a", name: "Suite A" },
            { id: "suite_b", name: "Suite B" },
          ],
        });
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

        render(<AllRunsPanel period={defaultPeriod} />, { wrapper: Wrapper });

        const groupBySelect = screen.getByLabelText("Group by");
        await userEvent.selectOptions(groupBySelect, "scenario");

        // Both runs from different suites should be grouped under one scenario
        const groupHeaders = screen.getAllByTestId("group-row-header");
        expect(groupHeaders.length).toBe(1);
        expect(screen.getByText("Shared Scenario")).toBeInTheDocument();
      });
    });
  });
});
