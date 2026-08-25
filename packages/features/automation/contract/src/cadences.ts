export const NOTIFICATION_CADENCES = [
  "immediate",
  "5min_digest",
  "15min_digest",
  "hourly_digest",
] as const;
export type NotificationCadence = (typeof NOTIFICATION_CADENCES)[number];
export const CADENCE_LABELS: Record<NotificationCadence, string> = {
  immediate: "Immediate",
  "5min_digest": "Every 5 minutes",
  "15min_digest": "Every 15 minutes",
  hourly_digest: "Every hour",
};
export const CADENCE_WINDOW_MS: Record<NotificationCadence, number> = {
  immediate: 0,
  "5min_digest": 5 * 60_000,
  "15min_digest": 15 * 60_000,
  hourly_digest: 60 * 60_000,
};
export const DEFAULT_TRACE_DEBOUNCE_MS = 30_000;
export const MIN_TRACE_DEBOUNCE_MS = 0;
export const MAX_TRACE_DEBOUNCE_MS = 10 * 60_000;
