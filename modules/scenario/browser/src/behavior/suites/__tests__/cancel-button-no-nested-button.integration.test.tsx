/**
 * Structural regression tests for the per-row Cancel button (#3192).
 * @vitest-environment jsdom
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { ScenarioRunStatus } from "@langwatch/scenario-contract";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioGridCard } from "../../../ui/elements/suite/runs/scenario-grid-card.tsx";
import { RunRow } from "../../../ui/sections/suite/run-row.tsx";
import { makeBatchRun, makeScenarioRunData, makeSummary } from "./run-history-fixtures.ts";

vi.mock("../use-prefetch-run-state.ts", () => ({
  usePrefetchRunState: () => vi.fn(),
}));

describe("<ScenarioGridCard/> per-row Cancel button structure (regression #3192)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given an in-progress run with onCancel", () => {
    /** @scenario "Per-row Cancel control is not a nested HTML button inside the card" */
    it("does not nest a <button> element inside the outer card button", () => {
      renderWithDesignSystem(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
      );

      const cancelButton = screen.getByTestId("cancel-run-button");
      const outerCardButton = screen.getByLabelText(/View details for/);
      expect(cancelButton.tagName.toLowerCase()).toBe("button");
      expect(outerCardButton.tagName.toLowerCase()).toBe("button");
      expect(outerCardButton.contains(cancelButton)).toBe(false);
    });
  });
});

describe("<RunRow/> per-row Cancel wiring in grid view (regression #3192)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when the per-row Cancel button is clicked in grid view", () => {
    /** @scenario "Per-row Cancel button on a grid card fires the cancel mutation" */
    it("calls onCancelRun with the scenario run and does not open the detail drawer", async () => {
      const user = userEvent.setup({ pointerEventsCheck: 0 });
      const onCancelRun = vi.fn();
      const onScenarioRunClick = vi.fn();
      const scenarioRun = makeScenarioRunData({
        scenarioRunId: "run_pending",
        status: ScenarioRunStatus.IN_PROGRESS,
        durationInMs: 0,
      });

      renderWithDesignSystem(
        <RunRow
          batchRun={makeBatchRun({ scenarioRuns: [scenarioRun] })}
          summary={makeSummary({
            inProgressCount: 1,
            totalCount: 1,
            passedCount: 0,
            passRate: 0,
          })}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={onScenarioRunClick}
          onCancelRun={onCancelRun}
          viewMode="grid"
        />,
      );

      const cancelButton = screen.getByTestId("cancel-run-button");
      await user.click(cancelButton);

      expect(onCancelRun).toHaveBeenCalledOnce();
      expect(onCancelRun).toHaveBeenCalledWith(scenarioRun);
      expect(onScenarioRunClick).not.toHaveBeenCalled();
    });
  });
});
