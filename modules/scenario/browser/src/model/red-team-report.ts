import {
  RED_TEAM_REPORT_METADATA_KEY,
  type RedTeamOutcome,
  type RedTeamRunReport,
  redTeamRunReportSchema,
} from "@langwatch/scenario-contract";

/**
 * The red team report a run's metadata carries, or null for a standard run or
 * an unreadable shape. The one place that reads the raw `redTeam` key.
 */
export function redTeamReportOf(metadata: unknown): RedTeamRunReport | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const raw = (metadata as Record<string, unknown>)[RED_TEAM_REPORT_METADATA_KEY];
  const parsed = redTeamRunReportSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const RED_TEAM_OUTCOME_LABELS: Record<RedTeamOutcome, string> = {
  held: "Held",
  broke: "Broke",
};

/** Text colour tokens for the outcome label: success when held, danger when broke. */
export const RED_TEAM_OUTCOME_COLORS: Record<RedTeamOutcome, string> = {
  held: "green.fg",
  broke: "red.fg",
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
