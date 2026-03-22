/**
 * @vitest-environment jsdom
 *
 * Integration tests for full-width borderless run history tables.
 *
 * Tests that RunRow and GroupRow headers have sticky positioning
 * and that the structure enables sticky to work within the scroll container.
 *
 * @see specs/features/suites/grid-view-and-borderless-tables.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunRow } from "../RunRow";
import { GroupRow } from "../GroupRow";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./test-helpers";
import type { RunGroup, RunGroupSummary } from "../run-history-transforms";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeGroup(overrides: Partial<RunGroup> = {}): RunGroup {
  return {
    groupKey: "group_1",
    groupLabel: "Angry refund request",
    groupType: "scenario",
    timestamp: Date.now(),
    scenarioRuns: [
      makeScenarioRunData(),
    ],
    ...overrides,
  };
}

function makeGroupSummary(
  overrides: Partial<RunGroupSummary> = {},
): RunGroupSummary {
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
    it("renders header as a direct child without wrapper Box", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      expect(header).toBeInTheDocument();
      expect(header).toHaveAttribute("data-testid", "run-row-header");
    });

    it("has a sticky header with position sticky", () => {
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

      const header = screen.getByRole("button", { name: /Run from/ });
      expect(header).toHaveStyle({ position: "sticky", top: "0px" });
    });
  });

  describe("when expanded in list view", () => {
    it("renders scenario rows spanning full width", () => {
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
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      expect(header).toBeInTheDocument();
      expect(header).toHaveAttribute("data-testid", "group-row-header");
    });

    it("has a sticky header", () => {
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

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      expect(header).toHaveStyle({ position: "sticky", top: "0px" });
    });
  });
});
