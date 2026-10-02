/** Persisted reasons why the platform paused an automation. */
export const AUTOMATION_PAUSE_REASONS = ["runaway_volume"] as const;

export type AutomationPauseReason = (typeof AUTOMATION_PAUSE_REASONS)[number];

/** The automation matched essentially all of the project's traffic. */
export const RUNAWAY_PAUSE_REASON: AutomationPauseReason = "runaway_volume";

/** What we tell the customer about a runaway pause. One constant because the
 *  list's Paused badge, the view drawer's badge and its "what happens next"
 *  answer all say it; the mailer's wording is deliberately its own. */
export const RUNAWAY_PAUSE_EXPLANATION =
  "This automation matched almost every trace in the project, so we paused it. Narrow its condition, then switch it back on.";

export function isAutomationPauseReason(
  reason: string | null | undefined,
): reason is AutomationPauseReason {
  return reason != null && (AUTOMATION_PAUSE_REASONS as readonly string[]).includes(reason);
}
