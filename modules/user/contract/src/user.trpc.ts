/**
 * Every `user.*` procedure and the one `identity.*` procedure this module owns.
 * The names are the browser's cache keys. The /me governance reads are `governance.*`.
 */
import { defineTrpcContract } from "@langwatch/module";

import { userAvatarRestParamsSchema } from "./user-rest.schemas.ts";
import {
  userApiBudgetIncreaseRequestedSchema,
  userApiHasPasswordSchema,
  userApiHomePagePickerStateSchema,
  userApiIsAdminSchema,
  userApiLinkedAccountsSchema,
  userApiOkSchema,
  userApiUpdatedNameSchema,
  userApiSuccessSchema,
} from "./user.responses.ts";
import {
  userApiEmptyInputSchema,
  userApiNotificationTopicInputSchema,
  userApiOrganizationInputSchema,
  userApiRequestBudgetIncreaseInputSchema,
  userApiSetAvatarInputSchema,
  userApiSetLastHomePathInputSchema,
  userApiSetNotificationPreferenceInputSchema,
  userApiUnlinkAccountInputSchema,
  userApiUpdateNameInputSchema,
  userApiUserInputSchema,
} from "./user.schemas.ts";
import {
  userAccountInfoSchema,
  userNotificationPreferenceSchema,
  userSecureAccountOfferSchema,
  userAvatarResultSchema,
  userAvatarUrlSchema,
  userSsoStatusSchema,
  userTourPreferenceSchema,
} from "./user.ts";

export const userTrpc = defineTrpcContract("user")
  // The address an uploaded avatar's `image` carries (`/api/user-avatar/:projectId/:userAvatarId`),
  // answered with the signed URL the browser renders it from (Alex, 2026-09-30).
  .query("getAvatarUrl")
  .withInput(userAvatarRestParamsSchema)
  .withOutput(userAvatarUrlSchema)

  .query("getTraceExplorerTourPreference")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userTourPreferenceSchema)

  .mutation("dismissTraceExplorerTour")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userTourPreferenceSchema)

  // Whether the caller wants browser notifications for one topic. The browser
  // permission is a separate fact the browser holds; this is the person's answer.
  .query("getNotificationPreference")
  .withInput(userApiNotificationTopicInputSchema)
  .withOutput(userNotificationPreferenceSchema)

  .mutation("setNotificationPreference")
  .withInput(userApiSetNotificationPreferenceInputSchema)
  .withOutput(userNotificationPreferenceSchema)

  // Whether to render admin-only surfaces. NOT an authorization gate: every
  // operator route asks the same question again on the server.
  .query("isAdmin")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiIsAdminSchema)

  .mutation("updateLastLogin")
  .withInput(userApiEmptyInputSchema)

  .query("getSsoStatus")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userSsoStatusSchema)

  .query("getAccountInfo")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userAccountInfoSchema)

  .query("getLinkedAccounts")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiLinkedAccountsSchema)

  .mutation("unlinkAccount")
  .withInput(userApiUnlinkAccountInputSchema)
  .withOutput(userApiSuccessSchema)

  .query("secureAccountNudge")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userSecureAccountOfferSchema)

  .mutation("dismissSecureAccountNudge")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("updateName")
  .withInput(userApiUpdateNameInputSchema)
  .withOutput(userApiUpdatedNameSchema)

  .query("hasPassword")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiHasPasswordSchema)

  .mutation("reactivate")
  .withInput(userApiUserInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("setAvatar")
  .withInput(userApiSetAvatarInputSchema)
  .withOutput(userAvatarResultSchema)

  .mutation("removeAvatar")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("requestBudgetIncrease")
  .withInput(userApiRequestBudgetIncreaseInputSchema)
  .withOutput(userApiBudgetIncreaseRequestedSchema)

  .mutation("setLastHomePath")
  .withInput(userApiSetLastHomePathInputSchema)
  .withOutput(userApiOkSchema)

  .query("homePagePickerState")
  .withInput(userApiOrganizationInputSchema)
  .withOutput(userApiHomePagePickerStateSchema)
  .build();
