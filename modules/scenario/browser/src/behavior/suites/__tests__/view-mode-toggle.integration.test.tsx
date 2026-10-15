/**
 * Integration tests for list/grid view mode toggle.
 * @vitest-environment jsdom
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type RunGroup,
  type RunGroupSummary,
} from "../../../model/suite/run-history-transforms.ts";
import { GroupRow } from "../../../ui/sections/suite/group-row.tsx";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../../../ui/sections/suite/run-history-filters.tsx";
import { RunRow } from "../../../ui/sections/suite/run-row.tsx";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./run-history-fixtures.ts";

vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

const scenarioOptions = [{ id: "scen_1", name: "Angry refund request" }];

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

function makeGroupSummary(overrides: Partial<RunGroupSummary> = {}): RunGroupSummary {
  return {
    passRate: 100,
    passedCount: 2,
    failedCount: 0,
    stalledCount: 0,
    cancelledCount: 0,
    completedCount: 2,
    totalCount: 2,
    inProgressCount: 0,
    queuedCount: 0,
    totalCost: null,
    averageAgentLatencyMs: null,
    totalDurationMs: null,
    agentLatencyStats: null,
    agentCostStats: null,
    averageAgentCost: null,
    ...overrides,
  };
}

describe("<RunHistoryFilters/> view mode toggle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when viewMode and onViewModeChange are provided", () => {
    /** @scenario "Filter bar shows a list/grid view toggle on suite detail" */
    /** @scenario "Filter bar shows a list/grid view toggle on all runs" */
    it("renders list and grid view toggle buttons", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
      );

      expect(screen.getByLabelText("List view")).toBeInTheDocument();
      expect(screen.getByLabelText("Grid view")).toBeInTheDocument();
    });

    it("defaults to grid view selected", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          viewMode="grid"
          onViewModeChange={vi.fn()}
        />,
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

        renderWithDesignSystem(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={vi.fn()}
            viewMode="grid"
            onViewModeChange={onViewModeChange}
          />,
        );

        await user.click(screen.getByLabelText("List view"));
        expect(onViewModeChange).toHaveBeenCalledWith("list");
      });
    });

    describe("when grid view button is clicked", () => {
      it("calls onViewModeChange with 'grid'", async () => {
        const user = userEvent.setup();
        const onViewModeChange = vi.fn();

        renderWithDesignSystem(
          <RunHistoryFilters
            scenarioOptions={scenarioOptions}
            filters={emptyFilters}
            onFiltersChange={vi.fn()}
            viewMode="list"
            onViewModeChange={onViewModeChange}
          />,
        );

        await user.click(screen.getByLabelText("Grid view"));
        expect(onViewModeChange).toHaveBeenCalledWith("grid");
      });
    });
  });

  describe("when viewMode and onViewModeChange are not provided", () => {
    it("does not render toggle buttons", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
        />,
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
    /** @scenario "Switching to grid view shows scenario results as cards" */
    it("renders scenario results in a grid container", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list")).not.toBeInTheDocument();
    });

    it("renders ScenarioGridCard for each scenario run", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="grid"
        />,
      );

      expect(screen.getByText(/Angry refund request/)).toBeInTheDocument();
      expect(screen.getByText(/Policy violation/)).toBeInTheDocument();
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario results in a list container", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
      );

      expect(screen.getByTestId("scenario-list")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-grid")).not.toBeInTheDocument();
    });
  });

  describe("when expanded with default viewMode", () => {
    it("defaults to grid view", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
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
      renderWithDesignSystem(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
          viewMode="grid"
        />,
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-list")).not.toBeInTheDocument();
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario results in a list container", () => {
      renderWithDesignSystem(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
          viewMode="list"
        />,
      );

      expect(screen.getByTestId("scenario-list")).toBeInTheDocument();
      expect(screen.queryByTestId("scenario-grid")).not.toBeInTheDocument();
    });
  });

  describe("when expanded with default viewMode", () => {
    it("defaults to grid view", () => {
      renderWithDesignSystem(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getByTestId("scenario-grid")).toBeInTheDocument();
    });
  });
});
