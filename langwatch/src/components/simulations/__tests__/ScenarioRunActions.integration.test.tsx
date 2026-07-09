/**
 * @vitest-environment jsdom
 *
 * Integration tests for ScenarioRunActions component.
 *
 * Tests the "Run again" button disabled state when a scenario has been archived.
 *
 * @see specs/scenarios/scenario-deletion.feature - "Run again is blocked for archived scenarios"
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScenarioRunActions } from "../ScenarioRunActions";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<ScenarioRunActions/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an archived scenario", () => {
    const archivedScenario = { archivedAt: new Date("2025-01-15T00:00:00Z") };

    describe("when viewing the run results", () => {
      it("disables the Run Again button", () => {
        render(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        const runAgainButton = screen.getByRole("button", {
          name: /run again/i,
        });
        expect(runAgainButton).toBeDisabled();
      });

      // The always-visible archived notice moved out of the action cluster:
      // the run detail drawer shows an "Archived" chip in its header strip,
      // and the disabled Run again button explains itself via tooltip.
      it("keeps the disabled Run again affordance visible", () => {
        render(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByRole("button", { name: /run again/i }),
        ).toBeVisible();
      });

      it("does not show the Edit Scenario button", () => {
        render(
          <ScenarioRunActions
            scenario={archivedScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.queryByRole("button", { name: /edit scenario/i }),
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("given an active (non-archived) scenario", () => {
    const activeScenario = { archivedAt: null };

    describe("when viewing the run results", () => {
      it("enables the Run Again button", () => {
        render(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        const runAgainButton = screen.getByRole("button", {
          name: /run again/i,
        });
        expect(runAgainButton).not.toBeDisabled();
      });

      it("does not display the archived message", () => {
        render(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.queryByText("This scenario has been archived"),
        ).not.toBeInTheDocument();
      });

      it("shows the Edit Scenario button", () => {
        render(
          <ScenarioRunActions
            scenario={activeScenario}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        expect(
          screen.getByRole("button", { name: /edit scenario/i }),
        ).toBeInTheDocument();
      });
    });
  });

  describe("given no scenario data", () => {
    describe("when viewing the run results", () => {
      it("renders nothing", () => {
        const { container } = render(
          <ScenarioRunActions
            scenario={null}
            isRunning={false}
            onRunAgain={vi.fn()}
            onEditScenario={vi.fn()}
          />,
          { wrapper: Wrapper },
        );

        expect(container.innerHTML).toBe("");
      });
    });
  });
});
