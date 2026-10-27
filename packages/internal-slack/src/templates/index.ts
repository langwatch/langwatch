import type { RegisteredNotice } from "../notice.ts";
import { billingThresholdFailureNotice } from "./billing-threshold-failure-notice.ts";
import { licensePurchaseNotice } from "./license-purchase-notice.ts";
import { planLimitReachedNotice, resourceLimitReachedNotice } from "./limit-notices.ts";
import {
  newOrganizationNotice,
  type NewOrganizationNoticeProps,
} from "./new-organization-notice.ts";
import { newUserNotice, type NewUserNoticeProps } from "./new-user-notice.ts";
import {
  scimSyncSummaryNotice,
  type ScimSyncSummaryNoticeProps,
} from "./scim-sync-summary-notice.ts";
import { selfHostedSignalNotice } from "./self-hosted-signal-notice.ts";
import {
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
} from "./subscription-notices.ts";
import { upgradeDiagnosticsNotice } from "./upgrade-diagnostics-notice.ts";

/** Every notice LangWatch posts to its own team, in the order the preview lists them. */
export const slackNotices: readonly RegisteredNotice[] = [
  newOrganizationNotice,
  newUserNotice,
  scimSyncSummaryNotice,
  subscriptionProspectiveNotice,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  licensePurchaseNotice,
  billingThresholdFailureNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  selfHostedSignalNotice,
  upgradeDiagnosticsNotice,
];

export type { NewOrganizationNoticeProps, NewUserNoticeProps, ScimSyncSummaryNoticeProps };

export {
  billingThresholdFailureNotice,
  licensePurchaseNotice,
  newOrganizationNotice,
  newUserNotice,
  planLimitReachedNotice,
  resourceLimitReachedNotice,
  scimSyncSummaryNotice,
  selfHostedSignalNotice,
  subscriptionActivatedNotice,
  subscriptionCancelledNotice,
  subscriptionProspectiveNotice,
  upgradeDiagnosticsNotice,
};
