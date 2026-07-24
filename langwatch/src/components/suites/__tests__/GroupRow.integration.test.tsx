/**
 * @vitest-environment jsdom
 *
 * Integration tests for GroupRow component.
 *
 * Tests that summary metrics appear in header and no footer is rendered.
 *
 * @see specs/features/suites/footer-to-header-migration.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GroupRow } from "../GroupRow";
import { makeScenarioRunData, makeSummary } from "./test-helpers";
import type { RunGroup } from "../run-history-transforms";

vi.mock("../usePrefetchRunState", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

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
    it("displays run count and pass rate", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1, totalCount: 5, passRate: 80 })}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("5 runs")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
    });

    it("displays pass rate in metrics summary", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary({ passedCount: 4, failedCount: 1, passRate: 80 })}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
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

  describe("when rendering the sticky header's backdrop blur", () => {
    /** @scenario "Blur effects turn off when the device can't keep a smooth frame rate" */
    it("references the shared --lw-backdrop-blur and --lw-panel-alpha CSS variables instead of hardcoded values", () => {
      render(
        <GroupRow
          group={makeGroup()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          onScenarioRunClick={vi.fn()}
          resolveTargetName={() => null}
        />,
        { wrapper: Wrapper },
      );

      // Chakra applies non-token style props via an emotion-injected
      // stylesheet class, not an inline `style` attribute — check the
      // injected CSS text rather than the DOM node's `.style`.
      const injectedCss = Array.from(document.querySelectorAll("style"))
        .map((s) => s.innerHTML)
        .join("\n");
      expect(injectedCss).toContain("--lw-backdrop-blur");
      // The header's background is semi-transparent specifically because
      // the blur diffuses whatever shows through it — removing just the
      // blur while leaving that transparency would turn a frosted header
      // into a literal see-through window onto the scrolling list behind
      // it, so --lw-panel-alpha must go with it.
      expect(injectedCss).toContain("--lw-panel-alpha");
    });
  });
});
