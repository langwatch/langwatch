/**
 * Why the platform paused an automation, as opposed to the customer switching
 * it off. Persisted on `Trigger.pausedReason`.
 *
 * Framework-free on purpose: the value is written by the server, read by the
 * automations list, and used as a metric label, so it has to be importable from
 * a client bundle without dragging prom-client or the app layer along with it.
 */
export const AUTOMATION_PAUSE_REASONS = ["runaway_volume"] as const;

export type AutomationPauseReason = (typeof AUTOMATION_PAUSE_REASONS)[number];

/**
 * The automation's confirmed matches covered essentially all of the project's
 * traffic, so it was selecting the project rather than selecting traces.
 */
export const RUNAWAY_PAUSE_REASON: AutomationPauseReason = "runaway_volume";

/**
 * What we tell the customer about a runaway pause: what their automation did,
 * and what to do about it.
 *
 * One constant because three surfaces say it — the automations list's Paused
 * badge, the view drawer's badge, and the drawer's "what happens next" answer
 * — and three hand-maintained copies of a sentence drift. The mailer's
 * wording is deliberately its own: an email is a different register from a
 * tooltip, and it is not trying to say the same sentence.
 */
export const RUNAWAY_PAUSE_EXPLANATION =
  "This automation matched almost every trace in the project, so we paused it. Narrow its condition, then switch it back on.";

/** Narrows the free-text column to a reason the UI knows how to explain. */
export function isAutomationPauseReason(
  reason: string | null | undefined,
): reason is AutomationPauseReason {
  return (
    reason !== null &&
    reason !== undefined &&
    (AUTOMATION_PAUSE_REASONS as readonly string[]).includes(reason)
  );
}
