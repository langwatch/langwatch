/**
 * Every `user.*` procedure and the one `identity.*` procedure this module owns.
 * The names are the browser's cache keys. `personalUsage`, `budgetOverview` and
 * `cliBootstrap` answer on `user` from Enterprise governance, merged by the process.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  createdUserSchema,
  identityVerificationCompletedSchema,
  userAccountInfoSchema,
  userAvatarResultSchema,
  userSsoStatusSchema,
  userTourPreferenceSchema,
} from "./user.ts";
import {
  userApiBudgetIncreaseRequestedSchema,
  userApiHasPasswordSchema,
  userApiHomePagePickerStateSchema,
  userApiIsAdminSchema,
  userApiLinkedAccountsSchema,
  userApiOkSchema,
  userApiPasskeyNudgeSchema,
  userApiPersonalBudgetSchema,
  userApiPersonalContextSchema,
  userApiSuccessSchema,
} from "./user.responses.ts";
import {
  userApiChangePasswordInputSchema,
  userApiCompleteVerificationInputSchema,
  userApiEmptyInputSchema,
  userApiOrganizationInputSchema,
  userApiRegisterInputSchema,
  userApiRequestBudgetIncreaseInputSchema,
  userApiSetAvatarInputSchema,
  userApiSetLastHomePathInputSchema,
  userApiSetPasswordInputSchema,
  userApiUnlinkAccountInputSchema,
  userApiUserInputSchema,
} from "./user.schemas.ts";

export const userTrpc = defineTrpcContract("user")
  // The account predates itself here: `register` is the signup form's backend
  // and runs with no caller at all.
  .mutation("register")
  .withInput(userApiRegisterInputSchema)
  .withOutput(createdUserSchema)

  .query("getTraceExplorerTourPreference")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userTourPreferenceSchema)

  .mutation("dismissTraceExplorerTour")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userTourPreferenceSchema)

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

  .query("passkeyNudge")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiPasskeyNudgeSchema)

  .mutation("dismissPasskeyNudge")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiSuccessSchema)

  .query("hasPassword")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiHasPasswordSchema)

  .mutation("setPassword")
  .withInput(userApiSetPasswordInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("changePassword")
  .withInput(userApiChangePasswordInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("deactivate")
  .withInput(userApiUserInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("reactivate")
  .withInput(userApiUserInputSchema)
  .withOutput(userApiSuccessSchema)

  .mutation("setAvatar")
  .withInput(userApiSetAvatarInputSchema)
  .withOutput(userAvatarResultSchema)

  .mutation("removeAvatar")
  .withInput(userApiEmptyInputSchema)
  .withOutput(userApiSuccessSchema)

  .query("personalContext")
  .withInput(userApiOrganizationInputSchema)
  .withOutput(userApiPersonalContextSchema)

  .query("personalBudget")
  .withInput(userApiOrganizationInputSchema)
  .withOutput(userApiPersonalBudgetSchema)

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

/**
 * Spending an email verification ceremony for the session user's own record.
 * The user module declares it because it acts on the caller's own account.
 * Spec: specs/identity/identifier-model.feature.
 */
export const identityTrpc = defineTrpcContract("identity")
  .mutation("completeVerification")
  .withInput(userApiCompleteVerificationInputSchema)
  .withOutput(identityVerificationCompletedSchema)
  .build();
