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
