/**
 * @vitest-environment jsdom
 *
 * Integration tests for group-by functionality in the run history UI.
 *
 * Tests the group-by selector in RunHistoryFilters and GroupRow rendering.
 *
 * @see specs/features/suites/run-history-group-by.feature - @integration scenarios
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import {
  RunHistoryFilters,
  type RunHistoryFilterValues,
} from "../RunHistoryFilters";
import { GroupRow } from "../GroupRow";
import { makeScenarioRunData } from "./test-helpers";
import type { RunGroup } from "../run-history-transforms";
import { computeGroupSummary } from "../run-history-transforms";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

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
    it("renders a group-by selector with correct options", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by");
      expect(selector).toBeInTheDocument();

      const options = within(selector).getAllByRole("option");
      const optionTexts = options.map((o) => o.textContent);
      expect(optionTexts).toEqual(["None", "Scenario", "Target"]);
    });

    it("has None selected by default", () => {
      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const selector = screen.getByLabelText("Group by") as HTMLSelectElement;
      expect(selector.value).toBe("none");
    });
  });

  describe("when a group-by option is selected", () => {
    it("calls onGroupByChange with the selected value", async () => {
      const user = userEvent.setup();
      const onGroupByChange = vi.fn();

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={emptyFilters}
          onFiltersChange={vi.fn()}
          groupBy="none"
          onGroupByChange={onGroupByChange}
        />,
        { wrapper: Wrapper },
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

      render(
        <RunHistoryFilters
          scenarioOptions={scenarioOptions}
          filters={activeFilters}
          onFiltersChange={onFiltersChange}
          groupBy="none"
          onGroupByChange={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // The scenario filter should still reflect "scen_1"
      const scenarioSelect = screen.getByLabelText(
        "Filter by scenario",
      ) as HTMLSelectElement;
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

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Login")).toBeInTheDocument();
    });

    it("displays pass rate and run count", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText(`${Math.round(summary.passRate)}%`)).toBeInTheDocument();
      expect(screen.getAllByText("2 runs").length).toBeGreaterThanOrEqual(1);
    });

    it("displays passed and failed counts in summary footer", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("1 passed")).toBeInTheDocument();
      expect(screen.getByText("1 failed")).toBeInTheDocument();
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

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("My Agent")).toBeInTheDocument();
    });

    it("displays pass rate and run count", () => {
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

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText(`${Math.round(summary.passRate)}%`)).toBeInTheDocument();
      expect(screen.getAllByText("3 runs").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("when expanded", () => {
    it("displays individual scenario runs", () => {
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      // Expanded should show scenario run details
      const rows = screen.getAllByLabelText(/View details for/);
      expect(rows).toHaveLength(2);
    });
  });

  describe("when the header is clicked", () => {
    it("calls onToggle", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();
      const group = makeGroup();
      const summary = computeGroupSummary({ group });

      render(
        <GroupRow
          group={group}
          summary={summary}
          isExpanded={false}
          onToggle={onToggle}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Login/ });
      await user.click(header);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });
});
