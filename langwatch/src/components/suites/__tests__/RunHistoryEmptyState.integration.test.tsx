/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunHistoryList empty states.
 *
 * @see specs/features/suites/suite-empty-state.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SimulationSuite } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RunHistoryList } from "../RunHistoryList";

// Hoisted mocks
const mockGetAllScenarioSetRunData = vi.hoisted(() => vi.fn());
const mockGetQueueStatus = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getAllScenarioSetRunData: { useQuery: mockGetAllScenarioSetRunData },
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    agents: {
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    suites: {
      getQueueStatus: { useQuery: mockGetQueueStatus },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: vi.fn(),
    isReady: true,
  }),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeSuite(
  overrides: Partial<SimulationSuite> = {},
): SimulationSuite {
  return {
    id: "suite_1",
    projectId: "proj_1",
    name: "Test Suite",
    slug: "test-suite",
    description: "",
    scenarioIds: ["scen_1"],
    targets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    labels: [],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

const widePeriod = {
  startDate: new Date("2024-01-01T00:00:00Z"),
  endDate: new Date("2024-12-31T23:59:59Z"),
};

describe("<RunHistoryList/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    mockGetQueueStatus.mockReturnValue({ data: undefined });
  });

  describe("given a suite with no runs", () => {
    beforeEach(() => {
      mockGetAllScenarioSetRunData.mockReturnValue({
        data: [],
        isLoading: false,
        error: null,
      });
    });

    it("displays an empty state message indicating no runs exist", () => {
      render(
        <RunHistoryList
          suite={makeSuite()}
          period={widePeriod}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("No runs yet"),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Run this suite to evaluate your scenarios and see results here.",
        ),
      ).toBeInTheDocument();
    });

    it("displays a Run CTA button", () => {
      render(
        <RunHistoryList
          suite={makeSuite()}
          period={widePeriod}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const runButton = screen.getByRole("button", { name: /run suite/i });
      expect(runButton).toBeInTheDocument();
    });

    it("calls onRun when the CTA button is clicked", async () => {
      const user = userEvent.setup();
      const onRun = vi.fn();

      render(
        <RunHistoryList
          suite={makeSuite()}
          period={widePeriod}
          onRun={onRun}
        />,
        { wrapper: Wrapper },
      );

      const runButton = screen.getByRole("button", { name: /run suite/i });
      await user.click(runButton);
      expect(onRun).toHaveBeenCalledOnce();
    });

    it("still shows QueueStatusBanner when jobs are pending", () => {
      mockGetQueueStatus.mockReturnValue({
        data: { waiting: 3, active: 0 },
      });

      render(
        <RunHistoryList
          suite={makeSuite()}
          period={widePeriod}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText("No runs yet"),
      ).toBeInTheDocument();
      // QueueStatusBanner should be rendered — it shows pending count
      expect(
        screen.getByText(/pending/i),
      ).toBeInTheDocument();
    });
  });

  describe("given a suite with at least one run", () => {
    beforeEach(() => {
      mockGetAllScenarioSetRunData.mockReturnValue({
        data: [
          {
            scenarioRunId: "run_1",
            scenarioId: "scen_1",
            batchId: "batch_1",
            timestamp: new Date("2024-06-15T12:00:00Z").getTime(),
            status: "SUCCESS",
            results: [],
            metadata: {},
          },
        ],
        isLoading: false,
        error: null,
      });
    });

    it("does not display the empty state and shows run results", () => {
      render(
        <RunHistoryList
          suite={makeSuite()}
          period={widePeriod}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /run suite/i }),
      ).not.toBeInTheDocument();
      // Positive assertion: a run row is rendered
      expect(screen.getByTestId("run-row-header")).toBeInTheDocument();
    });
  });

  describe("given a suite with runs outside the selected time period", () => {
    beforeEach(() => {
      mockGetAllScenarioSetRunData.mockReturnValue({
        data: [
          {
            scenarioRunId: "run_1",
            scenarioId: "scen_1",
            batchId: "batch_1",
            timestamp: new Date("2024-01-15T12:00:00Z").getTime(),
            status: "SUCCESS",
            results: [],
            metadata: {},
          },
        ],
        isLoading: false,
        error: null,
      });
    });

    it("does not display the onboarding empty state with Run CTA", () => {
      const narrowPeriod = {
        startDate: new Date("2024-06-01T00:00:00Z"),
        endDate: new Date("2024-06-30T23:59:59Z"),
      };

      render(
        <RunHistoryList
          suite={makeSuite()}
          period={narrowPeriod}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Should NOT show the onboarding CTA
      expect(screen.queryByText("No runs yet")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: /run suite/i }),
      ).not.toBeInTheDocument();

      // Should show a period-specific message instead
      expect(
        screen.getByText("No runs in the selected time period."),
      ).toBeInTheDocument();
    });
  });
});
