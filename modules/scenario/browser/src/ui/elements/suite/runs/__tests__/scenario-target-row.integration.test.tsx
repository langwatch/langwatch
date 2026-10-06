/**
 * A scenario row inside an expanded run: the status circle, status label and the metrics it has.
 * @vitest-environment jsdom
 * @see specs/scenarios/suites-page-metrics-display.feature
 * @see specs/features/suites/suite-list-view-status.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus, Verdict, type ScenarioRunData } from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioTargetRow } from "../scenario-target-row.tsx";

function runOf(overrides: Partial<ScenarioRunData> = {}): ScenarioRunData {
  return {
    scenarioId: "scenario_1",
    batchRunId: "batch_1",
    scenarioRunId: "run_1",
    name: "Refund request",
    status: ScenarioRunStatus.SUCCESS,
    messages: [],
    timestamp: 0,
    durationInMs: 0,
    ...overrides,
  };
}

function renderRow(scenarioRun: ScenarioRunData) {
  renderWithDesignSystem(
    <ScenarioTargetRow scenarioRun={scenarioRun} targetName={null} onClick={vi.fn()} />,
  );
  return screen.getByRole("button", { name: /View details for/ });
}

afterEach(cleanup);

describe("<ScenarioTargetRow/>", () => {
  describe("given a scenario run with status SUCCESS", () => {
    /** @scenario "List row shows colored status circle instead of icon" */
    it("draws a green circle on the left and no checkmark icon", () => {
      const row = renderRow(runOf({ status: ScenarioRunStatus.SUCCESS }));

      const circle = row.firstElementChild;
      expect(circle).toHaveStyle({ background: "var(--chakra-colors-green-500)" });
      expect(circle).toHaveStyle({ borderRadius: "var(--chakra-radii-full)" });
      expect(row.querySelector("svg")).toBeNull();
    });
  });

  describe("given a scenario run with null cost and no latency", () => {
    /** @scenario "List row without metrics shows only status label" */
    it("shows the status label and the duration, and no cost", () => {
      const row = renderRow(runOf({ durationInMs: 2300, totalCost: undefined }));
      const listRow = row.parentElement!;

      expect(within(listRow).getByText("Passed")).toBeInTheDocument();
      expect(within(listRow).getByText("2.3s")).toBeInTheDocument();
      expect(listRow.textContent).not.toContain("$");
      expect(within(listRow).queryByText("⋅")).not.toBeInTheDocument();
    });
  });

  describe("given a run that passed with 4 of 5 criteria met", () => {
    /** @scenario "List view row displays passed status with criteria count" */
    it("shows the status with its count and not a percentage", () => {
      const row = renderRow(
        runOf({
          status: ScenarioRunStatus.SUCCESS,
          results: {
            verdict: Verdict.SUCCESS,
            metCriteria: ["a", "b", "c", "d"],
            unmetCriteria: ["e"],
          },
        }),
      );

      expect(within(row.parentElement!).getByText("Passed (4/5)")).toBeInTheDocument();
      expect(row.textContent).not.toContain("100%");
    });
  });

  describe("given a run that failed with 2 of 5 criteria met", () => {
    /** @scenario "List view row displays failed status with criteria count" */
    it("shows the status with its count", () => {
      const row = renderRow(
        runOf({
          status: ScenarioRunStatus.FAILED,
          results: {
            verdict: Verdict.FAILURE,
            metCriteria: ["a", "b"],
            unmetCriteria: ["c", "d", "e"],
          },
        }),
      );

      expect(within(row.parentElement!).getByText("Failed (2/5)")).toBeInTheDocument();
    });
  });
});
