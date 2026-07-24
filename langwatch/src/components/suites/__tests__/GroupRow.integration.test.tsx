/**
 * @vitest-environment jsdom
 *
 * Integration tests for GroupRow component.
 *
 * Tests that summary metrics appear in header and no footer is rendered.
 *
 * @see specs/features/suites/footer-to-header-migration.feature
 */
import { Profiler } from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupRow } from "../GroupRow";
import { makeScenarioRunData, makeSummary } from "./test-helpers";
import type { RunGroup } from "../run-history-transforms";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";

vi.mock("../usePrefetchRunState", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

// RunMetricsSummary is always rendered (unconditionally, in the header), so
// spying on it — while still delegating to the real implementation, so
// existing assertions on its rendered output keep working — is a precise,
// deterministic signal for "did GroupRow's component function actually
// re-execute". See the equivalent useNow spy in RunRow.integration.test.tsx
// for why this is more reliable than counting Profiler.onRender calls
// directly.
const runMetricsSummarySpy = vi.fn();
vi.mock("../RunMetricsSummary", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../RunMetricsSummary")>();
  return {
    ...actual,
    RunMetricsSummary: (props: Parameters<typeof actual.RunMetricsSummary>[0]) => {
      runMetricsSummarySpy();
      return actual.RunMetricsSummary(props);
    },
  };
});

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

  describe("memoization", () => {
    /**
     * Same regression coverage as RunRow's memoization tests: the freshness
     * probe re-fetches the whole run list on every change anywhere in the
     * set, handing every group a brand-new wrapper object each poll. Wraps
     * GroupRow in React's Profiler to record real commit durations, and
     * cross-checks against the RunMetricsSummary spy (always rendered
     * unconditionally in the header) as the deterministic "did this
     * component's function actually re-execute" signal.
     */
    function ProfiledGroupRow({ group, onRender }: {
      group: RunGroup;
      onRender: (actualDuration: number) => void;
    }) {
      return (
        <Profiler
          id="group-row"
          onRender={(_id, _phase, actualDuration) => onRender(actualDuration)}
        >
          <GroupRow
            group={group}
            summary={makeSummary()}
            isExpanded={false}
            onToggle={vi.fn()}
            onScenarioRunClick={vi.fn()}
            resolveTargetName={() => null}
          />
        </Profiler>
      );
    }

    beforeEach(() => {
      runMetricsSummarySpy.mockClear();
    });

    it("skips re-rendering when scenarioRuns keep the same object identity", () => {
      const durations: number[] = [];
      const onRender = (d: number) => durations.push(d);
      const group = makeGroup();

      const { rerender } = render(
        <ProfiledGroupRow group={group} onRender={onRender} />,
        { wrapper: Wrapper },
      );
      expect(runMetricsSummarySpy).toHaveBeenCalledTimes(1);
      const mountDuration = durations[0]!;

      const freshWrapperSameRuns: RunGroup = { ...group };
      rerender(
        <ProfiledGroupRow group={freshWrapperSameRuns} onRender={onRender} />,
      );

      // The memoized row's function body never ran again...
      expect(runMetricsSummarySpy).toHaveBeenCalledTimes(1);
      // ...corroborated by the profiler: negligible work on that commit.
      expect(durations[1]).toBeLessThan(mountDuration);
    });

    it("re-renders when a scenario run actually changes", () => {
      const durations: number[] = [];
      const onRender = (d: number) => durations.push(d);
      const group = makeGroup();

      const { rerender } = render(
        <ProfiledGroupRow group={group} onRender={onRender} />,
        { wrapper: Wrapper },
      );
      expect(runMetricsSummarySpy).toHaveBeenCalledTimes(1);

      const changedGroup: RunGroup = {
        ...group,
        scenarioRuns: [
          { ...group.scenarioRuns[0]!, status: ScenarioRunStatus.FAILED },
          ...group.scenarioRuns.slice(1),
        ],
      };
      rerender(<ProfiledGroupRow group={changedGroup} onRender={onRender} />);

      expect(runMetricsSummarySpy).toHaveBeenCalledTimes(2);
      expect(durations[1]).toBeGreaterThan(0);
    });
  });
});
