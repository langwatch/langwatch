/**
 * Integration tests for group-by functionality in the run history UI.
 * @vitest-environment jsdom
 * @see specs/features/suites/run-history-group-by.feature - @integration scenarios
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { computeGroupSummary, type RunGroup } from "../../../model/suite/run-history-transforms.ts";
import { GroupRow } from "../../../ui/sections/suite/group-row.tsx";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../../../ui/sections/suite/run-history-filters.tsx";
import { makeScenarioRunData } from "./run-history-fixtures.ts";

vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

const scenarioOptions = [
  { id: "scen_1", name: "Login" },
  { id: "scen_2", name: "Signup" },
];

const emptyFilters: RunHistoryFilterValues = {
  scenarioId: "",
  passFailStatus: "",
};

describe("Group-by selector", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the run history list renders", () => {
    /** @scenario "Group-by selector renders with correct options" */
    it("renders a group-by selector with correct options", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
      );

      const selector = screen.getByLabelText("Group by");
      expect(selector).toBeInTheDocument();

      const options = within(selector).getAllByRole("option");
      const optionTexts = options.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });

    it("has None selected by default", () => {
      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
      );

      const selector = screen.getByLabelText("Group by") as HTMLSelectElement;
      expect(selector.value).toBe("none");
    });
  });

  describe("when a group-by option is selected", () => {
    it("calls onGroupByChange with the selected value", async () => {
      const user = userEvent.setup();
      const onGroupByChange = vi.fn();

      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={onGroupByChange}
        />,
      );

      const selector = screen.getByLabelText("Group by");
      await user.selectOptions(selector, "scenario");

      expect(onGroupByChange).toHaveBeenCalledWith("scenario");
    });
  });

  describe("when switching group-by mode", () => {
    it("preserves active filters", async () => {
      const user = userEvent.setup();
      const onFiltersChange = vi.fn();
      const activeFilters: RunHistoryFilterValues = {
        scenarioId: "scen_1",
        passFailStatus: "",
      };

      renderWithDesignSystem(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={activeFilters}
          onFiltersChange={onFiltersChange}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
      );

      // The scenario filter should still reflect "scen_1"
      const scenarioSelect = screen.getByLabelText("Filter by scenario") as HTMLSelectElement;
      expect(scenarioSelect.value).toBe("scen_1");

      // Changing group-by should not trigger onFiltersChange
      const groupBySelector = screen.getByLabelText("Group by");
      await user.selectOptions(groupBySelector, "scenario");

      expect(onFiltersChange).not.toHaveBeenCalled();
    });
  });
});

describe("<GroupRow/>", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function makeGroup(overrides: Partial<RunGroup> = {}): RunGroup {
    return {
      groupKey: "s1",
      groupLabel: "Login",
      groupType: "scenario",
      timestamp: Date.now(),
      scenarioRuns: [
        makeScenarioRunData({
          scenarioId: "s1",
          scenarioRunId: "run_1",
          name: "Login",
          status: ScenarioRunStatus.SUCCESS,
        }),
        makeScenarioRunData({
          scenarioId: "s1",
          scenarioRunId: "run_2",
          name: "Login",
          status: ScenarioRunStatus.ERROR,
        }),
      ],
      ...overrides,
    };
  }

  describe("when grouping by scenario", () => {
    it("displays the scenario name as group header", () => {
      const group = makeGroup({ groupLabel: "Login" });
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getByText("Login")).toBeInTheDocument();
    });

    it("displays run count and pass rate", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getAllByText("2 runs").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("50%")).toBeInTheDocument();
    });

    it("displays pass rate in metrics pill", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getByTestId("run-metrics-summary")).toBeInTheDocument();
    });
  });

  describe("when grouping by target", () => {
    it("displays the target name as group header", () => {
      const group = makeGroup({
        groupKey: "agent-1",
        groupLabel: "My Agent",
        groupType: "target",
      });
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getByText("My Agent")).toBeInTheDocument();
    });

    it("displays run count and pass rate", () => {
      const group = makeGroup({
        groupKey: "agent-1",
        groupLabel: "My Agent",
        groupType: "target",
        scenarioRuns: [
          makeScenarioRunData({
            scenarioRunId: "run_1",
            status: ScenarioRunStatus.SUCCESS,
          }),
          makeScenarioRunData({
            scenarioRunId: "run_2",
            status: ScenarioRunStatus.SUCCESS,
          }),
          makeScenarioRunData({
            scenarioRunId: "run_3",
            status: ScenarioRunStatus.ERROR,
          }),
        ],
      });
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      expect(screen.getByText("67%")).toBeInTheDocument();
      expect(screen.getAllByText("3 runs").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when expanded", () => {
    it("displays individual scenario runs", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      // Expanded should show scenario run details
      const rows = screen.getAllByLabelText(/View details for/);
      expect(rows).toHaveLength(2);
    });

    it("displays batch sub-headers for each batch", () => {
      const group: RunGroup = {
        groupKey: "s1",
        groupLabel: "Login",
        groupType: "scenario",
        timestamp: Date.now(),
        scenarioRuns: [
          makeScenarioRunData({
            scenarioId: "s1",
            scenarioRunId: "run_1",
            batchRunId: "batch_A",
            name: "Login",
            status: ScenarioRunStatus.SUCCESS,
          }),
          makeScenarioRunData({
            scenarioId: "s1",
            scenarioRunId: "run_2",
            batchRunId: "batch_B",
            name: "Login",
            status: ScenarioRunStatus.ERROR,
          }),
        ],
      };
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      const batchHeaders = screen.getAllByTestId("batch-sub-header");
      expect(batchHeaders).toHaveLength(2);
    });

    it("displays status counts in each batch sub-header", () => {
      const group: RunGroup = {
        groupKey: "s1",
        groupLabel: "Login",
        groupType: "scenario",
        timestamp: Date.now(),
        scenarioRuns: [
          makeScenarioRunData({
            scenarioId: "s1",
            scenarioRunId: "run_1",
            batchRunId: "batch_A",
            name: "Login",
            status: ScenarioRunStatus.SUCCESS,
          }),
        ],
      };
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      const batchHeader = screen.getByTestId("batch-sub-header");
      expect(within(batchHeader).getByText("1 passed")).toBeInTheDocument();
    });
  });

  describe("when the header is clicked", () => {
    it("calls onToggle", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      renderWithDesignSystem(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={onToggle}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      const header = screen.getByRole("button", { name: /Login/ });
      await user.click(header);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });
});
