/**
 * @vitest-environment jsdom
 *
 * Integration tests for SuiteDetailPanel and SuiteEmptyState components.
 *
 * Tests the suite header (name, labels, description), stats bar (scenario count,
 * target count, repeat count, executions), and empty state display.
 *
 * @see specs/suites/suite-workflow.feature - "Repeat count appears in suite stats bar"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SimulationSuite } from "@prisma/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SuiteDetailPanel, SuiteEmptyState } from "../SuiteDetailPanel";

// Hoisted mocks
const mockUseQuery = vi.hoisted(() => vi.fn());
const mockRouterPush = vi.hoisted(() => vi.fn());

vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      getAllScenarioSetRunData: { useQuery: mockUseQuery },
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    agents: {
      getAll: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    prompts: {
      getAllPromptsForProject: { useQuery: vi.fn(() => ({ data: [] })) },
    },
    suites: {
      getQueueStatus: { useQuery: vi.fn(() => ({ data: undefined })) },
    },
  },
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "proj_1", slug: "test-project" },
  }),
}));

vi.mock("~/utils/formatTimeAgo", () => ({
  formatTimeAgoCompact: (ts: number) => "2h ago",
}));

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: {},
    push: mockRouterPush,
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
    name: "Critical Path",
    slug: "critical-path",
    description: "Core test scenarios",
    scenarioIds: ["scen_1", "scen_2", "scen_3"],
    targets: [{ type: "http", referenceId: "agent_1" }],
    repeatCount: 1,
    labels: ["regression"],
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("<SuiteDetailPanel/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    // Default: no run data
    mockUseQuery.mockReturnValue({
      data: [],
      isLoading: false,
      error: null,
    });
  });

  describe("given a suite with name, description, and labels", () => {
    it("displays the suite name", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Critical Path")).toBeInTheDocument();
    });

    it("displays the suite description", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Core test scenarios")).toBeInTheDocument();
    });

    it("displays the label", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("#regression")).toBeInTheDocument();
    });
  });

  describe("given a suite with 3 scenarios, 1 target, and repeat count 1", () => {
    it("displays scenario, target, trial, and execution stats in the stats bar", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("scenarios")).toBeInTheDocument();
      expect(screen.getByText("targets")).toBeInTheDocument();
      expect(screen.getByText("1x")).toBeInTheDocument();
      expect(screen.getByText("trials")).toBeInTheDocument();
      expect(screen.getByText("executions")).toBeInTheDocument();
    });
  });

  describe("given a suite with repeat count 3", () => {
    it("displays '3x' in the trials stat", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite({ repeatCount: 3 })}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("3x")).toBeInTheDocument();
      expect(screen.getByText("trials")).toBeInTheDocument();
    });

    it("calculates correct execution count (3 scenarios x 1 target x 3 = 9)", () => {
      render(
        <SuiteDetailPanel
          suite={makeSuite({ repeatCount: 3 })}
          onEdit={vi.fn()}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("9")).toBeInTheDocument();
      expect(screen.getByText("executions")).toBeInTheDocument();
    });
  });

  describe("when Edit button is clicked", () => {
    it("calls onEdit", async () => {
      const user = userEvent.setup();
      const onEdit = vi.fn();

      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={onEdit}
          onRun={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      await user.click(screen.getByText("Edit"));
      expect(onEdit).toHaveBeenCalledOnce();
    });
  });

  describe("when Run button is clicked", () => {
    it("calls onRun", async () => {
      const user = userEvent.setup();
      const onRun = vi.fn();

      render(
        <SuiteDetailPanel
          suite={makeSuite()}
          onEdit={vi.fn()}
          onRun={onRun}
        />,
        { wrapper: Wrapper },
      );

      // There may be multiple "Run" texts (stat bar vs button); find the button
      const runButton = screen.getAllByText("Run").find((el) => {
        return el.closest("button") !== null;
      });
      expect(runButton).toBeDefined();
      await user.click(runButton!);
      expect(onRun).toHaveBeenCalledOnce();
    });
  });
});

describe("<SuiteEmptyState/>", () => {
  afterEach(() => {
    cleanup();
  });

  it("displays the empty state message", () => {
    render(
      <SuiteEmptyState onNewSuite={vi.fn()} />,
      {
        wrapper: ({ children }: { children: React.ReactNode }) => (
          <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
        ),
      },
    );

    expect(
      screen.getByText("Select a suite from the sidebar or create a new one"),
    ).toBeInTheDocument();
  });

  describe("when New Suite button is clicked", () => {
    it("calls onNewSuite", async () => {
      const user = userEvent.setup();
      const onNewSuite = vi.fn();

      render(
        <SuiteEmptyState onNewSuite={onNewSuite} />,
        {
          wrapper: ({ children }: { children: React.ReactNode }) => (
            <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
          ),
        },
      );

      await user.click(screen.getByText("New Suite"));
      expect(onNewSuite).toHaveBeenCalledOnce();
    });
  });
});
