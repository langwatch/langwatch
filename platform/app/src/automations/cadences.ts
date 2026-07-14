/**
 * Notification cadence constants — pure data shared between server dispatch
 * code and the automation drawer UI. Kept here (not in
 * `~/server/event-sourcing/pipelines/shared/triggerActionDispatch`) so the
 * browser bundle doesn't drag in the server-only logger + AsyncLocalStorage
 * chain via that module.
 */

export const NOTIFICATION_CADENCES = [
  "immediate",
  "5min_digest",
  "15min_digest",
  "hourly_digest",
] as const;

export type NotificationCadence = (typeof NOTIFICATION_CADENCES)[number];

/** Canonical display labels for each cadence, shared by every UI consumer. */
export const CADENCE_LABELS: Record<NotificationCadence, string> = {
  immediate: "Immediate",
  "5min_digest": "Every 5 minutes",
  "15min_digest": "Every 15 minutes",
  hourly_digest: "Every hour",
};

export const CADENCE_WINDOW_MS: Record<NotificationCadence, number> = {
  immediate: 0,
  "5min_digest": 5 * 60 * 1000,
  "15min_digest": 15 * 60 * 1000,
  hourly_digest: 60 * 60 * 1000,
};

/**
 * Default trace-readiness debounce in milliseconds (ADR-026). The quiet
 * period after the last span arrives before a trigger's filters re-evaluate
 * against the settled fold — applied to every trigger regardless of action
 * class. Matches the `Trigger.traceDebounceMs` schema default so new
 * rows inserted by the UI without a custom value preserve the historical
 * 30s behavior.
 */
export const DEFAULT_TRACE_DEBOUNCE_MS = 30_000;

/**
 * Bounds enforced by the router and the UI input. Lower bound is 0 (skip the
 * debounce entirely — useful for traces known to settle synchronously). Upper
 * bound is 10 minutes; values beyond that risk holding traces in the settle
 * stage longer than the outbox claim semantics expect.
 */
export const MIN_TRACE_DEBOUNCE_MS = 0;
export const MAX_TRACE_DEBOUNCE_MS = 10 * 60 * 1000;
