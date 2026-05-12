/**
 * @vitest-environment jsdom
 *
 * Structural regression tests for the per-row Cancel button (#3192).
 *
 * Browsers parse nested <button> elements by closing the outer button
 * prematurely. The visible cancel button — positioned `absolute` inside
 * the card's clickable surface — then receives clicks that don't reach
 * its handler, producing a no-op. The fix is to render the inner control
 * as a non-button element (span/div) with role="button" so the outer
 * card button remains the only real <button> in the tree.
 *
 * @see specs/features/scenarios/scenarios-editor-ui-regressions.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { ScenarioGridCard } from "../ScenarioGridCard";
import { RunRow } from "../RunRow";
import { makeScenarioRunData, makeBatchRun, makeSummary } from "./test-helpers";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioGridCard/> per-row Cancel button structure (regression #3192)", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given an in-progress run with onCancel", () => {
    /** @scenario "Per-row Cancel control is not a nested HTML button inside the card" */
    it("does not nest a <button> element inside the outer card button", () => {
      render(
        <ScenarioGridCard
          scenarioRun={makeScenarioRunData({
            status: ScenarioRunStatus.IN_PROGRESS,
            durationInMs: 0,
          })}
          targetName="Agent"
          onClick={vi.fn()}
          onCancel={vi.fn()}
        />,
        { wrapper: Wrapper },
      );

      const cancelButton = screen.getByTestId("cancel-run-button");
      // The cancel control must be an ARIA button on a non-button element so
      // it can live inside the outer card <button> without invalid HTML
      // nesting that browsers silently flatten.
      expect(cancelButton.tagName.toLowerCase()).not.toBe("button");
      expect(cancelButton.getAttribute("role")).toBe("button");

      // Belt-and-suspenders: assert the parent chain to the outer card button
      // contains no other <button> in between.
      const outerCardButton = screen.getByLabelText(/View details for/);
      expect(outerCardButton.tagName.toLowerCase()).toBe("button");
      let node: HTMLElement | null = cancelButton;
      while (node && node !== outerCardButton) {
        if (node !== cancelButton && node.tagName.toLowerCase() === "button") {
          throw new Error(
            `Unexpected nested <button> found between cancel control and outer card button: ${node.outerHTML.slice(0, 200)}`,
          );
        }
        node = node.parentElement;
      }
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

      render(
        <RunRow
          batchRun={makeBatchRun({ scenarioRuns: [scenarioRun] })}
          summary={makeSummary({ inProgressCount: 1, totalCount: 1, passedCount: 0, passRate: 0 })}
          isExpanded={true}
          onToggle={vi.fn()}
          resolveTargetName={() => "Agent"}
          onScenarioRunClick={onScenarioRunClick}
          onCancelRun={onCancelRun}
          viewMode="grid"
        />,
        { wrapper: Wrapper },
      );

      const cancelButton = screen.getByTestId("cancel-run-button");
      await user.click(cancelButton);

      expect(onCancelRun).toHaveBeenCalledOnce();
      expect(onCancelRun).toHaveBeenCalledWith(scenarioRun);
      expect(onScenarioRunClick).not.toHaveBeenCalled();
    });
  });
});
