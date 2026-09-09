/**
 * One screen, at `/settings/email-suppressions`. Its `emailSuppression.*`
 * transport is the automation family's mount point, addressed by its string so
 * the cache stays shared with the unsubscribe pair the mail client hits.
 */

import type { ComponentType } from "react";

export type NotificationScreenLoader = () => Promise<{ default: ComponentType }>;

export const notificationScreens = {
  emailSuppressions: () => import("./ui/sections/email-suppressions-screen.tsx"),
} as const satisfies Record<string, NotificationScreenLoader>;

export type NotificationScreenName = keyof typeof notificationScreens;

export {
  EMAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  EMAIL_SUPPRESSIONS_PAGE_PERMISSION,
} from "./ui/sections/email-suppressions-screen.tsx";
export {
  notificationApi,
  type EmailSuppressionRow,
  type NotificationApiMap,
} from "./behavior/notification-api.ts";
export {
  NotificationHostPort,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "./model/notification-host.ts";
