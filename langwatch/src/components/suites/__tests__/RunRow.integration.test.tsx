/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunRow component.
 *
 * Tests the collapsible run row behavior: expand/collapse,
 * display of status counts, timestamp, and scenario x target rows.
 *
 * @see specs/suites/suite-workflow.feature - "Run History List"
 */
import { Profiler } from "react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import type { BatchRun } from "../run-history-transforms";
import { RunRow } from "../RunRow";
import { makeScenarioRunData, makeBatchRun, makeSummary } from "./test-helpers";

// `useNow()` is called unconditionally at the top of RunRowData's render
// body, so spying on it is a precise, deterministic signal for "did this
// row's function component actually re-execute" — unlike React's Profiler,
// whose onRender fires per-commit at the boundary it wraps even when a
// memoized child bails out deeper in the tree (verified empirically: see
// the "memoization" tests below, which use both signals together).
const useNowSpy = vi.fn(() => Date.now());
vi.mock("~/hooks/useNow", () => ({ useNow: () => useNowSpy() }));

vi.mock("../usePrefetchRunState", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<RunRow/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when collapsed", () => {
    it("displays pass rate in metrics summary pill", () => {
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

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });

    it("does not display scenario x target rows", () => {
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

      expect(
        screen.queryByText(/Angry refund request/),
      ).not.toBeInTheDocument();
    });
  });

  describe("when expanded", () => {
    it("displays scenario x target rows", () => {
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

      expect(
        screen.getByText(/Angry refund request/),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/Policy violation/),
      ).toBeInTheDocument();
    });

    it("displays target name in scenario x target format in list view", () => {
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

      expect(
        screen.getByText(/Prod Agent: Angry refund request/),
      ).toBeInTheDocument();
    });

    it("displays duration for finished runs in list view", () => {
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

      const durationElements = screen.getAllByText("2.3s");
      expect(durationElements.length).toBeGreaterThan(0);
    });
  });

  describe("when the header is clicked", () => {
    it("calls onToggle", async () => {
      const user = userEvent.setup();
      const onToggle = vi.fn();

      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={onToggle}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = screen.getByRole("button", { name: /Run from/ });
      await user.click(header);
      expect(onToggle).toHaveBeenCalledOnce();
    });
  });

  describe("when a scenario x target row is clicked", () => {
    it("calls onScenarioRunClick with the scenario run data", async () => {
      const user = userEvent.setup();
      const onScenarioRunClick = vi.fn();
      const scenarioRun = makeScenarioRunData();

      render(
        <RunRow
          batchRun={makeBatchRun({ scenarioRuns: [scenarioRun] })}
          summary={makeSummary({ totalCount: 1, passedCount: 1 })}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={onScenarioRunClick}
        />,
        { wrapper: Wrapper },
      );

      const row = screen.getByLabelText(/View details for/);
      await user.click(row);
      expect(onScenarioRunClick).toHaveBeenCalledWith(scenarioRun);
    });
  });

  describe("when summary shows failures", () => {
    it("displays pass rate reflecting failures", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ passedCount: 2, failedCount: 1, passRate: 67 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("67%")).toBeInTheDocument();
    });
  });

  describe("when expectedJobCount is provided", () => {
    describe("when not all jobs are done", () => {
      it("displays progress indicator next to status counts", () => {
        render(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 2 })}
            isExpanded={false}
            onToggle={vi.fn()}
            resolveTargetName={() => "Prod Agent"}
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.getByText("2 of 6")).toBeInTheDocument();
      });
    });

    describe("when all jobs are done", () => {
      it("does not display progress indicator", () => {
        render(
          <RunRow
            batchRun={makeBatchRun()}
            summary={makeSummary({ totalCount: 6 })}
            isExpanded={false}
            onToggle={vi.fn()}
            resolveTargetName={() => "Prod Agent"}
            onScenarioRunClick={vi.fn()}
            expectedJobCount={6}
          />,
          { wrapper: Wrapper },
        );

        expect(screen.queryByText(/of 6/)).not.toBeInTheDocument();
      });
    });
  });

  describe("when expectedJobCount is not provided", () => {
    it("does not display progress indicator", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ totalCount: 2 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText(/of \d+/)).not.toBeInTheDocument();
    });
  });

  describe("when suiteName is provided (All Runs view)", () => {
    it("displays suite name in header", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => null}
          onScenarioRunClick={vi.fn()}
          suiteName="My Suite"
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("My Suite")).toBeInTheDocument();
    });
  });

  describe("when viewing summary metrics in header", () => {
    it("displays pass rate pill in header", () => {
      render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ passedCount: 8, failedCount: 2, passRate: 80 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("80%")).toBeInTheDocument();
    });

    it("renders RunMetricsSummary inside the header", () => {
      const { container } = render(
        <RunRow
          batchRun={makeBatchRun()}
          summary={makeSummary({ passedCount: 8, failedCount: 2, passRate: 80 })}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const header = container.querySelector('[data-testid="run-row-header"]');
      expect(header).toBeInTheDocument();
      const metrics = header?.querySelector('[data-testid="run-metrics-summary"]');
      expect(metrics).toBeInTheDocument();
    });
  });

  describe("when checking for footer removal", () => {
    it("does not render a RunSummaryFooter when expanded", () => {
      const { container } = render(
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

      expect(
        container.querySelector('[data-testid="run-summary-footer"]'),
      ).not.toBeInTheDocument();
    });

    it("does not render a RunSummaryFooter when collapsed", () => {
      const { container } = render(
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

      expect(
        container.querySelector('[data-testid="run-summary-footer"]'),
      ).not.toBeInTheDocument();
    });
  });

  describe("when suiteName is not provided (Suite-specific view)", () => {
    it("does not display scenario names in header", () => {
      const batchRun = makeBatchRun({
        scenarioRuns: [
          makeScenarioRunData({ name: "Login Flow", scenarioRunId: "r1" }),
          makeScenarioRunData({ name: "Checkout Flow", scenarioRunId: "r2" }),
        ],
      });

      render(
        <RunRow
          batchRun={batchRun}
          summary={makeSummary()}
          isExpanded={false}
          onToggle={vi.fn()}
          resolveTargetName={() => "Prod Agent"}
          onScenarioRunClick={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.queryByText("Checkout Flow, Login Flow")).not.toBeInTheDocument();
    });
  });

  describe("memoization", () => {
    /**
     * Regression test for the run-history flicker: the freshness probe
     * re-fetches the whole run list on every change anywhere in the set,
     * handing every row a brand-new `batchRun` wrapper object each poll.
     * Wraps RunRow in React's Profiler (as a developer inspecting this in
     * React DevTools would) to record each commit's render phase and
     * duration, and cross-checks against the useNow spy — a hook called
     * unconditionally at the top of RunRowData's body, so its call count is
     * a precise, deterministic signal for "did this row's component
     * function actually re-execute".
     *
     * Why both: React's Profiler.onRender fires per-commit for the boundary
     * it wraps even when a memoized child bails out deeper in the tree (it
     * measures the commit that touched this region, not whether the
     * memoized child itself did work) — confirmed empirically here by the
     * second commit's actualDuration collapsing near zero and useNow's call
     * count staying flat, versus a real re-render where both move together.
     */
    function ProfiledRunRow({ batchRun, onRender }: {
      batchRun: BatchRun;
      onRender: (actualDuration: number) => void;
    }) {
      return (
        <Profiler
          id="run-row"
          onRender={(_id, _phase, actualDuration) => onRender(actualDuration)}
        >
          <RunRow
            batchRun={batchRun}
            summary={makeSummary()}
            isExpanded={false}
            onToggle={vi.fn()}
            resolveTargetName={() => "Prod Agent"}
            onScenarioRunClick={vi.fn()}
          />
        </Profiler>
      );
    }

    beforeEach(() => {
      useNowSpy.mockClear();
    });

    it("skips re-rendering when scenarioRuns keep the same object identity", () => {
      const durations: number[] = [];
      const onRender = (d: number) => durations.push(d);
      const batchRun = makeBatchRun();

      const { rerender } = render(
        <ProfiledRunRow batchRun={batchRun} onRender={onRender} />,
        { wrapper: Wrapper },
      );
      expect(useNowSpy).toHaveBeenCalledTimes(1);
      const mountDuration = durations[0]!;

      // A fresh wrapper object (as groupRunsByBatchId produces every poll)
      // but the SAME scenarioRuns array references — exactly what
      // preserveUnchangedRunIdentity produces for an unchanged batch.
      const freshWrapperSameRuns: BatchRun = { ...batchRun };
      rerender(
        <ProfiledRunRow batchRun={freshWrapperSameRuns} onRender={onRender} />,
      );

      // The memoized row's function body never ran again...
      expect(useNowSpy).toHaveBeenCalledTimes(1);
      // ...which the profiler corroborates: the second commit did
      // negligible work compared to the initial mount, since it never
      // descended into RunRowData at all.
      expect(durations[1]).toBeLessThan(mountDuration);
    });

    it("re-renders when a scenario run actually changes", () => {
      const durations: number[] = [];
      const onRender = (d: number) => durations.push(d);
      const batchRun = makeBatchRun();

      const { rerender } = render(
        <ProfiledRunRow batchRun={batchRun} onRender={onRender} />,
        { wrapper: Wrapper },
      );
      expect(useNowSpy).toHaveBeenCalledTimes(1);

      const changedBatchRun: BatchRun = {
        ...batchRun,
        scenarioRuns: [
          { ...batchRun.scenarioRuns[0]!, status: ScenarioRunStatus.FAILED },
          batchRun.scenarioRuns[1]!,
        ],
      };
      rerender(
        <ProfiledRunRow batchRun={changedBatchRun} onRender={onRender} />,
      );

      // A genuine data change re-executes RunRowData's body...
      expect(useNowSpy).toHaveBeenCalledTimes(2);
      // ...and the profiler shows real render work on that commit too,
      // unlike the bailout case above.
      expect(durations[1]).toBeGreaterThan(0);
    });
  });
});
