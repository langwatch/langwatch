/**
 * The notification family, as the browser application mounts it.
 *
 * ONE SCREEN, ONE ADDRESS: `/settings/email-suppressions`.
 *
 * THE TRANSPORT IS A NEIGHBOUR'S, and it is recorded rather than hidden.
 * `emailSuppression.*` is mounted from `@langwatch/automation-server` and the
 * row's helpers are `@langwatch/automation-contract`'s, so the credentials
 * family's rule — a key belongs to the family that owns its transport — reads
 * this key as the automation family's. It is here because the surface is about
 * NOTIFICATION DELIVERY rather than about the rule that sends one: the page
 * answers "who stopped hearing from us, and how do I resume it", which is the
 * notification feature's question and not the automation's. Addressing the
 * neighbour's mount point by its string costs this package nothing but the
 * strings — the analytics family's argument — and the segment name is kept
 * exactly so the cache stays shared with the unsubscribe pair.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider this
 * package's hooks run on and the host port that answers for the project, the
 * manage grant and the two notices.
 */

import type { ComponentType } from "react";

export type NotificationScreenLoader = () => Promise<{ default: ComponentType }>;

export const notificationScreens = {
  emailSuppressions: () => import("./email-suppressions.screen"),
} as const satisfies Record<string, NotificationScreenLoader>;

export type NotificationScreenName = keyof typeof notificationScreens;

export {
  EMAIL_SUPPRESSIONS_MANAGE_PERMISSION,
  EMAIL_SUPPRESSIONS_PAGE_PERMISSION,
} from "./email-suppressions.screen";
export {
  notificationApi,
  type EmailSuppressionRow,
  type NotificationApiMap,
} from "../../behavior/notification-api";
export {
  NotificationHostPort,
  NotificationHostProvider,
  type NotificationFailureNotice,
  type NotificationHostProject,
  type NotificationSuccessNotice,
} from "../../model/notification-host";
