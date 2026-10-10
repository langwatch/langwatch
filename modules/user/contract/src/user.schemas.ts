import type { Named } from "@langwatch/module";
/** Input schemas for the `user.*` tRPC surface. Secrets never stored here. */
import { z } from "zod";

import {
  userNotificationChoiceSchema,
  userNotificationTopicSchema,
  userProfileNameSchema,
} from "./user.ts";

/**
 * The procedures that take no arguments still declare a parser, because tRPC
 * appends the input middleware where `.input()` is called and the process's
 * policy is applied after it.
 */
const userApiEmptyInputSchemaDefinition = z.object({});
export interface UserApiEmptyInputSchema extends Named<typeof userApiEmptyInputSchemaDefinition> {}
export const userApiEmptyInputSchema: UserApiEmptyInputSchema = userApiEmptyInputSchemaDefinition;

/** The caller's own choice for one notification topic. */
const userApiNotificationTopicInputSchemaDefinition = z.object({
  topic: userNotificationTopicSchema,
});
export interface UserApiNotificationTopicInputSchema extends Named<
  typeof userApiNotificationTopicInputSchemaDefinition
> {}
export const userApiNotificationTopicInputSchema: UserApiNotificationTopicInputSchema =
  userApiNotificationTopicInputSchemaDefinition;

/** The caller turns one notification topic on or off. */
const userApiSetNotificationPreferenceInputSchemaDefinition = z.object({
  topic: userNotificationTopicSchema,
  choice: userNotificationChoiceSchema,
});
export interface UserApiSetNotificationPreferenceInputSchema extends Named<
  typeof userApiSetNotificationPreferenceInputSchemaDefinition
> {}
export const userApiSetNotificationPreferenceInputSchema: UserApiSetNotificationPreferenceInputSchema =
  userApiSetNotificationPreferenceInputSchemaDefinition;

/** A blank name is refused here, not trimmed down to nothing and stored. */
const userApiUpdateNameInputSchemaDefinition = z.object({ name: userProfileNameSchema });
export interface UserApiUpdateNameInputSchema extends Named<
  typeof userApiUpdateNameInputSchemaDefinition
> {}
export const userApiUpdateNameInputSchema: UserApiUpdateNameInputSchema =
  userApiUpdateNameInputSchemaDefinition;

const userApiRegisterInputSchemaDefinition = z.object({
  // Optional: the front door does not ask. Onboarding does, in a place
  // where the question is worth a field. The legacy sign-up page still
  // sends one, so it is taken when it comes.
  name: z.string().min(1, "Name is required").optional(),
  email: z.string().email("Invalid email"),
  // Length only here; the POLICY is checked in the body so its refusal
  // can carry `meta.fieldErrors` and land on the field the person is
  // looking at. An input-schema rejection arrives as a tRPC parse error
  // with no field to hang on.
  password: z.string().min(1),
  /** The single-use proof a spent confirmation link minted for this address. */
  addressProof: z.string().min(1),
});
export interface UserApiRegisterInputSchema extends Named<
  typeof userApiRegisterInputSchemaDefinition
> {}
export const userApiRegisterInputSchema: UserApiRegisterInputSchema =
  userApiRegisterInputSchemaDefinition;

const userApiUnlinkAccountInputSchemaDefinition = z.object({ accountId: z.string() });
export interface UserApiUnlinkAccountInputSchema extends Named<
  typeof userApiUnlinkAccountInputSchemaDefinition
> {}
export const userApiUnlinkAccountInputSchema: UserApiUnlinkAccountInputSchema =
  userApiUnlinkAccountInputSchemaDefinition;

const userApiSetPasswordInputSchemaDefinition = z.object({ password: z.string().min(1) });
export interface UserApiSetPasswordInputSchema extends Named<
  typeof userApiSetPasswordInputSchemaDefinition
> {}
export const userApiSetPasswordInputSchema: UserApiSetPasswordInputSchema =
  userApiSetPasswordInputSchemaDefinition;

const userApiChangePasswordInputSchemaDefinition = z.object({
  // Required for both modes — the user must re-confirm their current
  // password to change it. Defends against a stolen session lock-out: even
  // with a valid session cookie, an attacker can't change the password
  // without knowing the existing one.
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});
export interface UserApiChangePasswordInputSchema extends Named<
  typeof userApiChangePasswordInputSchemaDefinition
> {}
export const userApiChangePasswordInputSchema: UserApiChangePasswordInputSchema =
  userApiChangePasswordInputSchemaDefinition;

/** One user, for the procedures that name a person other than the caller. */
const userApiUserInputSchemaDefinition = z.object({ userId: z.string() });
export interface UserApiUserInputSchema extends Named<typeof userApiUserInputSchemaDefinition> {}
export const userApiUserInputSchema: UserApiUserInputSchema = userApiUserInputSchemaDefinition;

const userApiSetAvatarInputSchemaDefinition = z.object({
  organizationId: z.string(),
  // A base64 image data URL (`data:image/...;base64,...`) from the client
  // crop/resize step. Deliberately NOT bounded with `.max()`: `parseAvatarDataUrl`
  // rejects at the same ceiling first, so both halves answer with the
  // specific `avatar_image_too_large` rather than turning it into `validation_error`.
  imageDataUrl: z.string().min(1),
});
export interface UserApiSetAvatarInputSchema extends Named<
  typeof userApiSetAvatarInputSchemaDefinition
> {}
export const userApiSetAvatarInputSchema: UserApiSetAvatarInputSchema =
  userApiSetAvatarInputSchemaDefinition;

/** One organization, for the reads scoped to a whole tenant. */
const userApiOrganizationInputSchemaDefinition = z.object({ organizationId: z.string() });
export interface UserApiOrganizationInputSchema extends Named<
  typeof userApiOrganizationInputSchemaDefinition
> {}
export const userApiOrganizationInputSchema: UserApiOrganizationInputSchema =
  userApiOrganizationInputSchemaDefinition;

/** Defaults to the start of this month through now unless both ends are given. */
const userApiRequestBudgetIncreaseInputSchemaDefinition = z.object({
  organizationId: z.string(),
  scope: z.string(),
  scopeId: z.string(),
  limitUsd: z.string(),
  spentUsd: z.string(),
  period: z.string().optional(),
  message: z.string().max(2000).optional(),
});
export interface UserApiRequestBudgetIncreaseInputSchema extends Named<
  typeof userApiRequestBudgetIncreaseInputSchemaDefinition
> {}
export const userApiRequestBudgetIncreaseInputSchema: UserApiRequestBudgetIncreaseInputSchema =
  userApiRequestBudgetIncreaseInputSchemaDefinition;

const userApiSetLastHomePathInputSchemaDefinition = z.object({
  path: z.string().min(1).max(1024).regex(/^\//, "must start with /").nullable(),
});
export interface UserApiSetLastHomePathInputSchema extends Named<
  typeof userApiSetLastHomePathInputSchemaDefinition
> {}
export const userApiSetLastHomePathInputSchema: UserApiSetLastHomePathInputSchema =
  userApiSetLastHomePathInputSchemaDefinition;

export type UserApiEmptyInput = z.infer<typeof userApiEmptyInputSchema>;
export type UserApiRegisterInput = z.infer<typeof userApiRegisterInputSchema>;
export type UserApiUnlinkAccountInput = z.infer<typeof userApiUnlinkAccountInputSchema>;
export type UserApiSetPasswordInput = z.infer<typeof userApiSetPasswordInputSchema>;
export type UserApiChangePasswordInput = z.infer<typeof userApiChangePasswordInputSchema>;
export type UserApiUserInput = z.infer<typeof userApiUserInputSchema>;
export type UserApiSetAvatarInput = z.infer<typeof userApiSetAvatarInputSchema>;
export type UserApiOrganizationInput = z.infer<typeof userApiOrganizationInputSchema>;
export type UserApiRequestBudgetIncreaseInput = z.infer<
  typeof userApiRequestBudgetIncreaseInputSchema
>;
export type UserApiSetLastHomePathInput = z.infer<typeof userApiSetLastHomePathInputSchema>;

/** How Langy reaches this person's code: "github" when they asked to be remembered, null to ask. */
const userCodeAccessPreferenceSchemaDefinition = z
  .object({ preference: z.literal("github").nullable() })
  .strict();
export interface UserCodeAccessPreferenceSchema extends Named<
  typeof userCodeAccessPreferenceSchemaDefinition
> {}
export const userCodeAccessPreferenceSchema: UserCodeAccessPreferenceSchema =
  userCodeAccessPreferenceSchemaDefinition;
export type UserCodeAccessPreference = z.infer<typeof userCodeAccessPreferenceSchema>;
