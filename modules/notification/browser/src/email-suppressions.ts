/**
 * One screen, at `/settings/email-suppressions`. Its `emailSuppression.*`
 * transport is the automation family's mount point, addressed by its string so
 * the cache stays shared with the unsubscribe pair the mail client hits.
 */

export {
  notificationApi,
  type EmailSuppressionRow,
  type NotificationApiMap,
} from "./behavior/notification-api.ts";
export {
  EMAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  EMAIL_SUPPRESSIONS_PAGE_PERMISSION,
  NotificationHostApi,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "./model/notification-host.ts";
