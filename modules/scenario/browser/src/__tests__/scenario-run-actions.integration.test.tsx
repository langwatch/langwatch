/**
 * Integration tests for ScenarioRunActions component.
 * @vitest-environment jsdom
 * @see specs/scenarios/scenario-deletion.feature - "Run again is blocked for archived scenarios"
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ScenarioRunActions } from "../ui/elements/scenario-run-actions.tsx";

describe("<ScenarioRunActions/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an archived scenario", () => {
    const archivedScenario = { archivedAt: new Date("2025-01-15T00:00:00Z").toISOString() };

    describe("when viewing the run results", () => {
      // aria-disabled (not native disabled) keeps the button focusable so
      // the archived-explanation tooltip stays reachable.
      it("marks the Run Again button aria-disabled and ignores clicks", async () => {
        const onRunAgain = vi.fn();
        const user = userEvent.setup();
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={onRunAgain}
            onEditScenario={vi.fn()}
          />,
        );

        const runAgainButton = screen.getByRole("button", {
          name: /run again/i,
        });
        expect(runAgainButton).toHaveAttribute("aria-disabled", "true");
        expect(runAgainButton).not.toBeDisabled();
        await user.click(runAgainButton);
        expect(onRunAgain).not.toHaveBeenCalled();
      });

      // The always-visible archived notice moved out of the action cluster:
      // the run detail drawer shows an "Archived" chip in its header strip,
      // and the disabled Run again button explains itself via tooltip.
      it("keeps the disabled Run again affordance visible", () => {
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        expect(screen.getByRole("button", { name: /run again/i })).toBeVisible();
      });

      it("does not show the Edit Scenario button", () => {
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        expect(screen.queryByRole("button", { name: /edit scenario/i })).not.toBeInTheDocument();
      });
    });
  });

  describe("given an active (non-archived) scenario", () => {
    const activeScenario = { archivedAt: null };

    describe("when viewing the run results", () => {
      it("enables the Run Again button", () => {
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        const runAgainButton = screen.getByRole("button", {
          name: /run again/i,
        });
        expect(runAgainButton).not.toBeDisabled();
      });

      it("does not display the archived message", () => {
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        expect(screen.queryByText("This scenario has been archived")).not.toBeInTheDocument();
      });

      it("shows the Edit Scenario button", () => {
        renderWithDesignSystem(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        expect(screen.getByRole("button", { name: /edit scenario/i })).toBeInTheDocument();
      });
    });
  });

  describe("given no scenario data", () => {
    describe("when viewing the run results", () => {
      it("renders nothing", () => {
        const { container } = renderWithDesignSystem(
          <ScenarioRunActions
            scenario={null}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
        );

        expect(container.innerHTML).toBe("");
      });
    });
  });
});
