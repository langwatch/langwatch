/**
 * @vitest-environment jsdom
 *
 * Integration tests for list/grid view mode toggle.
 *
 * Tests the view toggle in RunHistoryFilters and the rendering
 * of scenario results in grid vs list mode within RunRow and GroupRow.
 *
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../RunHistoryFilters";
import { RunRow } from "../RunRow";
import { GroupRow } from "../GroupRow";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./test-helpers";
import type { RunGroup, RunGroupSummary } from "../run-history-transforms";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

const scenarioOptions = [
  { id: "scen_1", name: "Angry refund request" },
];

function makeGroup(overrides: Partial<RunGroup> = {}): RunGroup {
  return {
    groupKey: "group_1",
    groupLabel: "Angry refund request",
    groupType: "scenario",
    timestamp: Date.now(),
    scenarioRuns: [
      makeScenarioRunData(),
      makeScenarioRunData({
        scenarioRunId: "run_2",
        scenarioId: "scen_2",
        name: "Policy violation",
      }),
    ],
    ...overrides,
  };
}

function makeGroupSummary(
  overrides: Partial<RunGroupSummary> = {},
): RunGroupSummary {
  return {
    passRate: 100,
    passedCount: 2,
    failedCount: 0,
    stalledCount: 0,
    cancelledCount: 0,
    totalCount: 2,
    inProgressCount: 0,
    ...overrides,
  };
}

describe("<RunHistoryFilters/> view mode toggle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when viewMode and onViewModeChange are provided", () => {
    it("renders list and grid view toggle buttons", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByLabelText("List view")).toBeInTheDocument();
      expect(screen.getByLabelText("Grid view")).toBeInTheDocument();
    });

    it("defaults to grid view selected", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const gridButton = screen.getByLabelText("Grid view");
      expect(gridButton).toHaveAttribute("aria-pressed", "true");

      const listButton = screen.getByLabelText("List view");
      expect(listButton).toHaveAttribute("aria-pressed", "false");
    });

    describe("when list view button is clicked", () => {
      it("calls onViewModeChange with 'list'", async () => {
        const user = userEvent.setup();
        const onViewModeChange = vi.fn();

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={vi.fn()}
            viewMode="grid"
            onViewModeChange={onViewModeChange}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByLabelText("List view"));
        expect(onViewModeChange).toHaveBeenCalledWith("list");
      });
    });

    describe("when grid view button is clicked", () => {
      it("calls onViewModeChange with 'grid'", async () => {
        const user = userEvent.setup();
        const onViewModeChange = vi.fn();

        render(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={vi.fn()}
            viewMode="list"
            onViewModeChange={onViewModeChange}
          />,
          { wrapper: Wrapper },
        );

        await user.click(screen.getByLabelText("Grid view"));
        expect(onViewModeChange).toHaveBeenCalledWith("grid");
      });
    });
  });

  describe("when viewMode and onViewModeChange are not provided", () => {
    it("does not render toggle buttons", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByLabelText("List view")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("Grid view")).not.toBeInTheDocument();
    });
  });
});

describe("<RunRow/> view mode", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when expanded in grid view", () => {
    it("renders scenario results in a grid container", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list")).not.toBeInTheDocument();
    });

    it("renders ScenarioGridCard for each scenario run", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      expect(
        screen.getByText(/Angry refund request/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Policy violation/),
      ).toBeInTheDocument();
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario results in a list container", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-list")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-grid")).not.toBeInTheDocument();
    });
  });

  describe("when expanded with default viewMode", () => {
    it("defaults to grid view", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
    });
  });
});

describe("<GroupRow/> view mode", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when expanded in grid view", () => {
    it("renders scenario results in a grid container", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list")).not.toBeInTheDocument();
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario results in a list container", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
          viewMode="list"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-list")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-grid")).not.toBeInTheDocument();
    });
  });

  describe("when expanded with default viewMode", () => {
    it("defaults to grid view", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
    });
  });
});
