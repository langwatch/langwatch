import type { RegisteredNotice } from "../notice.ts";
import { billingThresholdFailureNotice } from "./billing-threshold-failure-notice.ts";
import { licensePurchaseNotice } from "./license-purchase-notice.ts";
import { planLimitReachedNotice, resourceLimitReachedNotice } from "./limit-notices.ts";
import { newUserNotice, type NewUserNoticeProps } from "./new-user-notice.ts";
import { selfHostedSignalNotice } from "./self-hosted-signal-notice.ts";
import {
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
} from "./subscription-notices.ts";

/** Every notice LangWatch posts to its own team, in the order the preview lists them. */
export const slackNotices: readonly RegisteredNotice[] = [
  newUserNotice,
  subscriptionProspectiveNotice,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  licensePurchaseNotice,
  billingThresholdFailureNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  selfHostedSignalNotice,
];

export type { NewUserNoticeProps };

export {
  billingThresholdFailureNotice,
  licensePurchaseNotice,
  newUserNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  selfHostedSignalNotice,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
};
