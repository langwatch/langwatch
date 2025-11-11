import type { NOTIFICATION_TYPES } from "./notification-types-constant";

/**
 * Type for notification types
 */
export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

