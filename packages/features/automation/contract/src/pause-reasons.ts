/** Persisted reasons why the platform paused an automation. */
export const AUTOMATION_PAUSE_REASONS = ["runaway_volume"] as const;

export type AutomationPauseReason = (typeof AUTOMATION_PAUSE_REASONS)[number];

/** The automation matched essentially all of the project's traffic. */
export const RUNAWAY_PAUSE_REASON: AutomationPauseReason = "runaway_volume";

export function isAutomationPauseReason(
	reason: string | null | undefined,
): reason is AutomationPauseReason {
	return (
		reason != null &&
		(AUTOMATION_PAUSE_REASONS as readonly string[]).includes(reason)
	);
}
