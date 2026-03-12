/**
 * @vitest-environment jsdom
 *
 * Integration tests for GroupRow component.
 *
 * Tests that summary counts appear in header and no footer is rendered.
 *
 * @see specs/features/suites/footer-to-header-migration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRow } from "../GroupRow";
import { makeScenarioRunData, makeSummary } from "./test-helpers";
import type { RunGroup } from "../run-history-transforms";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function makeGroup(overrides: Partial<RunGroup> = {}): RunGroup {
  return {
    groupKey: "group_1",
    groupLabel: "Login Scenario",
    groupType: "scenario",
    timestamp: Date.now(),
    scenarioRuns: [
      makeScenarioRunData({ scenarioRunId: "r1" }),
      makeScenarioRunData({ scenarioRunId: "r2" }),
      makeScenarioRunData({ scenarioRunId: "r3" }),
      makeScenarioRunData({ scenarioRunId: "r4" }),
      makeScenarioRunData({ scenarioRunId: "r5" }),
    ],
    ...overrides,
  };
}

describe("<GroupRow/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when viewing the header", () => {
    it("displays compact counts with icons alongside run count", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1, totalCount: 5 })}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("5 runs")).toBeInTheDocument();
      expect(screen.getByText("4 ✓")).toBeInTheDocument();
      expect(screen.getByText("1 ✗")).toBeInTheDocument();
    });

    it("does not display redundant standalone status label", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1 })}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      // No standalone "passed" or "failed" text -- only compact icons
      expect(screen.queryByText("passed")).not.toBeInTheDocument();
      expect(screen.queryByText("failed")).not.toBeInTheDocument();
    });
  });

  describe("when expanded", () => {
    it("does not render a RunSummaryFooter", () => {
      const { container } = render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1 })}
          isExpanded={true}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(
        container.querySelector('[data-testid="run-summary-footer"]'),
      ).not.toBeInTheDocument();
    });
  });

  describe("when collapsed", () => {
    it("does not render a RunSummaryFooter", () => {
      const { container } = render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1 })}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(
        container.querySelector('[data-testid="run-summary-footer"]'),
      ).not.toBeInTheDocument();
    });
  });
});
