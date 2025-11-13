/**
 * Notification types stored in metadata.type field
 */
export const NOTIFICATION_TYPES = {
  USAGE_LIMIT_WARNING: "USAGE_LIMIT_WARNING",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

