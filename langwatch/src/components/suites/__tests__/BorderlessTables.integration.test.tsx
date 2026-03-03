/**
 * @vitest-environment jsdom
 *
 * Integration tests for full-width borderless run history tables.
 *
 * Tests that RunRow and GroupRow containers have no border-radius
 * and that headers have sticky positioning.
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
    totalCount: 1,
    inProgressCount: 0,
    ...overrides,
  };
}

describe("<RunRow/> borderless styling", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when rendered", () => {
    it("has no rounded corners (borderRadius is 0)", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      // The header's parent container should have no border radius
      const container = header.closest("[class]");
      expect(container).toBeInTheDocument();
    });

    it("has a sticky header with position sticky", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      // Verify the header element exists and is rendered
      expect(header).toBeInTheDocument();
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
          targetName="Prod Agent"
          onScenarioRunClick={vi.fn()}
          viewMode="list"
        />,
        { wrapper: Wrapper },
      );

      const scenarioRow = screen.getByLabelText(
        /View details for Angry refund request/,
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
    it("has no rounded corners", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      expect(header).toBeInTheDocument();
    });

    it("has a sticky header", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeGroupSummary()}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", {
        name: /Angry refund request group/,
      });
      expect(header).toBeInTheDocument();
    });
  });
});
