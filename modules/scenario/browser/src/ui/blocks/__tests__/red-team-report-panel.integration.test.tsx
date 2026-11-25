/**
 * @vitest-environment jsdom
 * @see modules/scenario/specs/red-team-scenario.feature
 */
import { renderWithDesignSystem } from "@langwatch/design-system/testing";
import type { RedTeamRunReport } from "@langwatch/scenario-contract";
import { cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { RedTeamReportPanel } from "../red-team-report-panel.tsx";

afterEach(cleanup);

function reportOf(overrides: Partial<RedTeamRunReport> = {}): RedTeamRunReport {
  return {
    outcome: "held",
    brokeAtTurn: null,
    strategy: "crescendo",
    owaspIds: ["LLM01", "LLM07"],
    attackGoal: "Make the agent reveal its system prompt",
    maxTurns: 30,
    turnsUsed: 30,
    turnScores: [],
    ...overrides,
  };
}

describe("<RedTeamReportPanel/>", () => {
  describe("given a red team run that held", () => {
    /** @scenario "The run view shows a held red team run" */
    it("shows Held in the success colour with the OWASP ids, goal and turns used", () => {
      renderWithDesignSystem(<RedTeamReportPanel report={reportOf()} />);

      const badge = screen.getByTestId("red-team-outcome");
      expect(badge).toHaveTextContent("Held");
      expect(badge).toHaveAttribute("data-palette", "green");
      expect(screen.getByText("LLM01 Prompt Injection")).toBeInTheDocument();
      expect(screen.getByText("LLM07 System Prompt Leakage")).toBeInTheDocument();
      expect(screen.getByText("Make the agent reveal its system prompt")).toBeInTheDocument();
      expect(screen.getByText("Held for 30 of 30 turns")).toBeInTheDocument();
      expect(screen.queryByText(/passed|failed/i)).toBeNull();
    });
  });

  describe("given a red team run that broke on turn 3", () => {
    /** @scenario "The run view shows the turn a broken red team run broke on and each turn's score" */
    it("shows Broke in the danger colour, the turn it broke on and every turn's score and hint", () => {
      renderWithDesignSystem(
        <RedTeamReportPanel
          report={reportOf({
            outcome: "broke",
            brokeAtTurn: 3,
            turnsUsed: 3,
            turnScores: [
              { turn: 1, score: 2, hint: "Refused politely" },
              { turn: 2, score: 5 },
              { turn: 3, score: 9.5, hint: "Quoted its instructions" },
            ],
          })}
        />,
      );

      const badge = screen.getByTestId("red-team-outcome");
      expect(badge).toHaveTextContent("Broke");
      expect(badge).toHaveAttribute("data-palette", "red");
      expect(screen.getByText("Broke on turn 3 of 30")).toBeInTheDocument();
      expect(within(screen.getByTestId("red-team-turn-1")).getByText("2/10")).toBeInTheDocument();
      expect(screen.getByText("Refused politely")).toBeInTheDocument();
      expect(within(screen.getByTestId("red-team-turn-2")).getByText("5/10")).toBeInTheDocument();
      const thirdTurn = within(screen.getByTestId("red-team-turn-3"));
      expect(thirdTurn.getByText("9.5/10")).toBeInTheDocument();
      expect(thirdTurn.getByText("Quoted its instructions")).toBeInTheDocument();
    });
  });
});
