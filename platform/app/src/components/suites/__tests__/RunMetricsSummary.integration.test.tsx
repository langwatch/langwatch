/**
 * @vitest-environment jsdom
 *
 * Integration tests for RunMetricsSummary component.
 *
 * Tests the display logic for pass rate, progress indicators,
 * and status categorization in run accordion headers.
 *
 * @see specs/features/suites/sidebar-summary-status.feature
 * @see specs/scenarios/suites-page-metrics-display.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { MetricStats } from "~/components/shared/MetricStatsTooltip";
import { RunMetricsSummary } from "../RunMetricsSummary";
import { makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const agentLatencyStats: MetricStats = {
  min: 800,
  avg: 1600,
  median: 1500,
  p75: 2100,
  p90: 2600,
  p95: 3100,
  p99: 3600,
  max: 4200,
  total: 12800,
  count: 8,
};

const agentCostStats: MetricStats = {
  min: 0.001,
  avg: 0.003,
  median: 0.0025,
  p75: 0.0035,
  p90: 0.004,
  p95: 0.0045,
  p99: 0.0048,
  max: 0.005,
  total: 0.024,
  count: 8,
};

/** A finished group of 8 runs: 6 passed, 2 failed, with metrics on every run. */
function groupWithMetrics() {
  return makeSummary({
    passRate: 75,
    passedCount: 6,
    failedCount: 2,
    completedCount: 8,
    totalCount: 8,
    expectedCount: 8,
    totalDurationMs: 3200,
    totalCost: 0.024,
    averageAgentLatencyMs: 1600,
    averageAgentCost: 0.003,
    agentLatencyStats,
    agentCostStats,
  });
}

/**
 * The tooltip renders in a portal, and some of its labels ("Pass") also appear
 * on the pill itself. Resolve a tooltip row by taking the match that is NOT
 * inside the pill — the row a reader sees in the popover.
 */
function tooltipRow(label: string): HTMLElement {
  const pill = screen.getByTestId("run-metrics-summary");
  const match = screen.getAllByText(label).find((el) => !pill.contains(el));
  if (!match?.parentElement) {
    throw new Error(`No tooltip row found for "${label}"`);
  }
  return match.parentElement;
}

describe("<RunMetricsSummary/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("when all runs passed", () => {
    it("displays Pass label with 100% and green circle", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 100,
            passedCount: 3,
            totalCount: 3,
            completedCount: 3,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("100%")).toBeInTheDocument();
    });
  });

  describe("when some runs failed", () => {
    it("displays pass rate reflecting failures", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 50,
            passedCount: 3,
            failedCount: 3,
            totalCount: 6,
            completedCount: 6,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("50%")).toBeInTheDocument();
    });
  });

  describe("when all runs are stalled (no verdicts)", () => {
    it("displays dash with no red color", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            stalledCount: 3,
            completedCount: 0,
            totalCount: 3,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("-")).toBeInTheDocument();
      expect(screen.queryByText("0%")).not.toBeInTheDocument();
    });
  });

  describe("when all runs failed (0% with verdicts)", () => {
    it("displays 0% not dash", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 0,
            passedCount: 0,
            failedCount: 2,
            completedCount: 2,
            totalCount: 2,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0%")).toBeInTheDocument();
      expect(screen.queryByText("-")).not.toBeInTheDocument();
    });
  });

  describe("when runs are in progress with no completed runs", () => {
    it("displays lightning progress indicator only", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            completedCount: 0,
            totalCount: 3,
            inProgressCount: 3,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0/3")).toBeInTheDocument();
      expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    });
  });

  describe("when runs are in progress with partial results", () => {
    it("displays both progress and partial pass rate", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 33,
            passedCount: 1,
            failedCount: 0,
            completedCount: 1,
            totalCount: 3,
            inProgressCount: 2,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("1/3")).toBeInTheDocument();
      expect(screen.getByText("Pass")).toBeInTheDocument();
      expect(screen.getByText("33%")).toBeInTheDocument();
    });
  });

  describe("when the group has a total duration and a total cost", () => {
    /** @scenario Accordion header shows pass rate circle with duration and cost */
    it("shows the pass rate alongside the duration and cost labels", () => {
      render(<RunMetricsSummary summary={groupWithMetrics()} />, {
        wrapper: Wrapper,
      });

      const pill = screen.getByTestId("run-metrics-summary");
      expect(within(pill).getByText("75%")).toBeInTheDocument();
      expect(within(pill).getByText("3.2s")).toBeInTheDocument();
      expect(within(pill).getByText("$0.0240")).toBeInTheDocument();
    });
  });

  describe("when the user hovers the summary pill", () => {
    /** @scenario Accordion header tooltip breaks the group down by pass, latency and cost */
    it("breaks the group down by pass, completion, latency and cost", async () => {
      const user = userEvent.setup();
      render(<RunMetricsSummary summary={groupWithMetrics()} />, {
        wrapper: Wrapper,
      });

      await user.hover(screen.getByTestId("run-metrics-summary"));

      await waitFor(() =>
        expect(screen.getByText("Completed")).toBeInTheDocument(),
      );

      for (const [label, value] of [
        ["Pass", "75%"],
        ["Completed", "8/8"],
        ["Avg Agent Latency", "1.6s"],
        ["Avg Agent Cost", "$0.003000"],
        ["Total Duration", "3.2s"],
        ["Total Cost", "$0.0240"],
      ] as const) {
        expect(within(tooltipRow(label)).getByText(value)).toBeInTheDocument();
      }

      // The per-role split (agent / judge / user simulator) is a property of an
      // individual run row, not of the group header — see ScenarioTargetRow.
      expect(screen.queryByText(/user simulator/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/judge/i)).not.toBeInTheDocument();
    });

    /** @scenario Accordion header tooltip expands agent latency into a percentile distribution */
    it("expands the agent latency row into a percentile distribution", async () => {
      const user = userEvent.setup();
      render(<RunMetricsSummary summary={groupWithMetrics()} />, {
        wrapper: Wrapper,
      });

      await user.hover(screen.getByTestId("run-metrics-summary"));
      await waitFor(() =>
        expect(screen.getByText("Avg Agent Latency")).toBeInTheDocument(),
      );

      // The nested tooltip opens on pointer movement over the row, which is
      // what a real cursor travelling into it produces.
      fireEvent.pointerMove(tooltipRow("Avg Agent Latency"), {
        pointerType: "mouse",
      });

      await waitFor(() => expect(screen.getByText("p95")).toBeInTheDocument());
      // The distribution, not the single average already shown on the row.
      expect(
        within(screen.getByText("Median (p50)").parentElement!).getByText(
          "1.5s",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByText("p95").parentElement!).getByText("3.1s"),
      ).toBeInTheDocument();
    });
  });

  describe("when the group predates the metrics migration", () => {
    /** @scenario Accordion header shows only pass rate when no cost/latency data */
    it("shows the pass rate and no latency or cost label", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: 75,
            passedCount: 6,
            failedCount: 2,
            completedCount: 8,
            totalCount: 8,
            expectedCount: 8,
            totalDurationMs: null,
            totalCost: null,
          })}
        />,
        { wrapper: Wrapper },
      );

      const pill = screen.getByTestId("run-metrics-summary");
      expect(within(pill).getByText("75%")).toBeInTheDocument();
      expect(pill.textContent).toBe("Pass75%");
    });
  });

  describe("when a single run is queued", () => {
    it("displays lightning progress with 0/1", () => {
      render(
        <RunMetricsSummary
          summary={makeSummary({
            passRate: null,
            passedCount: 0,
            failedCount: 0,
            completedCount: 0,
            totalCount: 1,
            queuedCount: 1,
            inProgressCount: 0,
          })}
        />,
        { wrapper: Wrapper },
      );

      expect(screen.getByText("0/1")).toBeInTheDocument();
      expect(screen.queryByText("Pass")).not.toBeInTheDocument();
    });
  });
});
