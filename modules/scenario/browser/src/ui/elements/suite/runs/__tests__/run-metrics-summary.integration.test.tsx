/**
 * The metrics pill of a run group header: pass rate, with average agent latency and cost.
 * @vitest-environment jsdom
 * @see specs/scenarios/suites-page-metrics-display.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus, type ScenarioRunData } from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { computeGroupSummary } from "../../../../../model/suite/run-history-transforms.ts";
import { RunMetricsSummary } from "../run-metrics-summary.tsx";

function run(
  index: number,
  status: ScenarioRunStatus,
  overrides: Partial<ScenarioRunData> = {},
): ScenarioRunData {
  return {
    scenarioId: `scenario_${index}`,
    batchRunId: "batch_1",
    scenarioRunId: `run_${index}`,
    status,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    ...overrides,
  };
}

afterEach(cleanup);

describe("<RunMetricsSummary/>", () => {
  describe("given a run group of 6 passed and 2 failed runs with latency and cost", () => {
    /** @scenario Accordion header shows pass rate circle with latency and cost */
    it("shows 75%, a clock with the average agent latency and the total cost", () => {
      const metrics = { roleLatencies: { Agent: [3200] }, totalCost: 0.003, durationInMs: 9000 };
      const statuses = [
        ...Array.from({ length: 6 }, () => ScenarioRunStatus.SUCCESS),
        ...Array.from({ length: 2 }, () => ScenarioRunStatus.FAILED),
      ];
      const summary = computeGroupSummary({
        group: {
          groupKey: "batch_1",
          groupLabel: "batch_1",
          groupType: "none",
          timestamp: 0,
          scenarioRuns: statuses.map((status, index) => run(index, status, metrics)),
        },
      });

      renderWithDesignSystem(<RunMetricsSummary summary={summary} />);

      const pill = screen.getByTestId("run-metrics-summary");
      const percentage = within(pill).getByText("75%");
      expect(percentage.previousElementSibling).toHaveStyle({
        background: "var(--chakra-colors-green-500)",
      });
      const latency = within(pill).getByText("3.2s");
      expect(latency.previousElementSibling?.tagName.toLowerCase()).toBe("svg");
      expect(within(pill).getByText("$0.024")).toBeInTheDocument();
      expect(pill.textContent).not.toContain("1.2m");
    });
  });

  describe("given a run group from before the metrics migration, with null cost and latency", () => {
    /** @scenario "Accordion header shows only pass rate when no cost/latency data" */
    it("shows the pass rate circle and percentage and neither latency nor cost", () => {
      const summary = computeGroupSummary({
        group: {
          groupKey: "batch_1",
          groupLabel: "batch_1",
          groupType: "none",
          timestamp: 0,
          scenarioRuns: [
            run(1, ScenarioRunStatus.SUCCESS),
            run(2, ScenarioRunStatus.SUCCESS),
            run(3, ScenarioRunStatus.SUCCESS),
            run(4, ScenarioRunStatus.FAILED),
          ],
        },
      });
      expect(summary.totalCost).toBeNull();
      expect(summary.totalDurationMs).toBeNull();

      renderWithDesignSystem(<RunMetricsSummary summary={summary} />);

      const pill = screen.getByTestId("run-metrics-summary");
      const percentage = within(pill).getByText("75%");
      expect(percentage).toBeInTheDocument();
      const circle = percentage.previousElementSibling;
      expect(circle).toHaveStyle({ background: "var(--chakra-colors-green-500)" });
      expect(pill.querySelector("svg")).toBeNull();
      expect(pill.textContent).toBe("Pass75%");
    });
  });
});
