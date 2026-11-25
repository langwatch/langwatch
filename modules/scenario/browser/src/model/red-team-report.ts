import {
  extractRedTeamRunReport,
  type RedTeamOutcome,
  type RedTeamRunReport,
} from "@langwatch/scenario-contract";

/**
 * The red team report a run's metadata carries under `langwatch`, or null for
 * a standard run or an unreadable shape.
 */
export function redTeamReportOf(metadata: unknown): RedTeamRunReport | null {
  return extractRedTeamRunReport(metadata) ?? null;
}

export const RED_TEAM_OUTCOME_LABELS: Record<RedTeamOutcome, string> = {
  held: "Held",
  broke: "Broke",
};

/** Colour palette per outcome: success when held, danger when broke. */
export const RED_TEAM_OUTCOME_PALETTES: Record<RedTeamOutcome, "green" | "red"> = {
  held: "green",
  broke: "red",
};

/** Text colour tokens for the outcome label, from the outcome's palette. */
export const RED_TEAM_OUTCOME_COLORS: Record<RedTeamOutcome, string> = {
  held: `${RED_TEAM_OUTCOME_PALETTES.held}.fg`,
  broke: `${RED_TEAM_OUTCOME_PALETTES.broke}.fg`,
};

/** "Broke on turn 3 of 30" or "Held for 30 of 30 turns": the line under the outcome. */
export function redTeamTurnSummary({ report }: { report: RedTeamRunReport }): string {
  if (report.outcome === "broke" && report.brokeAtTurn !== null) {
    return `Broke on turn ${report.brokeAtTurn} of ${report.maxTurns}`;
  }
  if (report.outcome === "broke") {
    return `Broke after ${report.turnsUsed} of ${report.maxTurns} turns`;
  }
  return `Held for ${report.turnsUsed} of ${report.maxTurns} turns`;
}
