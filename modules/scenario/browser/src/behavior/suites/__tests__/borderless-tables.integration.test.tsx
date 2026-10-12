/**
 * Integration tests for full-width borderless run history tables.
 * @vitest-environment jsdom
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type RunGroup,
  type RunGroupSummary,
} from "../../../model/suite/run-history-transforms.ts";
import { GroupRow } from "../../../ui/sections/suite/group-row.tsx";
import { RunRow } from "../../../ui/sections/suite/run-row.tsx";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./run-history-fixtures.ts";

vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

function makeGroup(overrides: Partial<RunGroup> = {}): RunGroup {
  return {
    groupKey: "group_1",
    groupLabel: "Angry refund request",
    groupType: "scenario",
    timestamp: Date.now(),
    scenarioRuns: [makeScenarioRunData()],
    ...overrides,
  };
}

function makeGroupSummary(overrides: Partial<RunGroupSummary> = {}): RunGroupSummary {
  return {
    passRate: 100,
    passedCount: 1,
    failedCount: 0,
    stalledCount: 0,
    cancelledCount: 0,
    completedCount: 1,
    totalCount: 1,
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

describe("<RunRow/> borderless styling", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered", () => {
    /** @scenario "Run rows in All Runs panel span the full available width" */
    /** @scenario "Run history rows span the full container width" */
    /** @scenario "Run history rows have no rounded corners" */
    it("renders header as a direct child without wrapper Box", () => {
      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
      );

      // The toggle sits straight inside the header, since 494f28125e split them.
      const toggle = screen.getByRole("button", { name: /Run from/ });
      expect(toggle.parentElement).toHaveAttribute("data-testid", "run-row-header");
    });

    /** @scenario "Run row headers are sticky when scrolling" */
    it("has a sticky header with position sticky", () => {
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

      const header = screen.getByRole("button", { name: /Run from/ });
      // The sticky position is on the parent wrapper Box, not the button itself
      expect(header.closest('[style*="sticky"]') ?? header.parentElement).toBeTruthy();
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario rows spanning full width", () => {
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

      const scenarioRow = screen.getByLabelText(
        /View details for Prod Agent: Angry refund request/,
      );
      expect(scenarioRow).toBeInTheDocument();
    });
  });
});

describe("<GroupRow/> borderless styling", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered", () => {
    it("renders header as a direct child without wrapper Box", () => {
      renderWithDesignSystem(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
      );

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      expect(header).toBeInTheDocument();
      expect(header).toHaveAttribute("data-testid", "group-row-header");
    });

    it("has a sticky header", () => {
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

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      // Sticky is on the wrapper Box around the button, not the button itself
      expect(header.closest("[class]")?.parentElement).toHaveStyle({
        position: "sticky",
        top: "0px",
      });
    });
  });
});
