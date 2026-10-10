import { ledgerActorSchema } from "@langwatch/authorization";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const USER_FEATURE_ID = "user" as const;
export const USER_KSUID_RESOURCE = "user" as const;
export const USER_ACCOUNT_KSUID_RESOURCE = "account" as const;
export const USER_AVATAR_PURPOSE = "user_avatar" as const;
export const USER_AVATAR_OWNER_KIND = "user" as const;
export const USER_AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const USER_AVATAR_MAX_DATA_URL_LENGTH = Math.ceil(USER_AVATAR_MAX_BYTES / 3) * 4 + 256;
export const USER_AVATAR_ALLOWED_MEDIA_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const userAvatarMediaTypeSchema = z.enum(USER_AVATAR_ALLOWED_MEDIA_TYPES);
export type UserAvatarMediaType = z.infer<typeof userAvatarMediaTypeSchema>;

export function safeUserAvatarMediaType(mediaType: string): string {
  return userAvatarMediaTypeSchema.validate(mediaType) ? mediaType : "application/octet-stream";
}

const userProfileSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    emailVerified: z.boolean(),
    image: z.string().nullable(),
    pendingSsoSetup: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    lastLoginAt: z.date().nullable(),
    deactivatedAt: z.date().nullable(),
  })
  .strict();
export interface UserProfileSchema extends Named<typeof userProfileSchemaDefinition> {}
export const userProfileSchema: UserProfileSchema = userProfileSchemaDefinition;
export type UserProfile = z.infer<typeof userProfileSchema>;

const userFullProfileSchemaDefinition = userProfileSchema
  .safeExtend({
    lastHomePath: z.string().nullable(),
    tracesExplorerTourDismissedAt: z.date().nullable(),
  })
  .strict();
export interface UserFullProfileSchema extends Named<typeof userFullProfileSchemaDefinition> {}
export const userFullProfileSchema: UserFullProfileSchema = userFullProfileSchemaDefinition;
export type UserFullProfile = z.infer<typeof userFullProfileSchema>;

const userIdInputSchemaDefinition = z.object({ id: z.string().min(1) }).strict();
export interface UserIdInputSchema extends Named<typeof userIdInputSchemaDefinition> {}
export const userIdInputSchema: UserIdInputSchema = userIdInputSchemaDefinition;
export type UserIdInput = z.infer<typeof userIdInputSchema>;

/** A deactivation or reactivation, and who made it. */
const userLifecycleChangeInputSchemaDefinition = z
  .object({ id: z.string().min(1), actor: ledgerActorSchema })
  .strict();
export interface UserLifecycleChangeInputSchema extends Named<
  typeof userLifecycleChangeInputSchemaDefinition
> {}
export const userLifecycleChangeInputSchema: UserLifecycleChangeInputSchema =
  userLifecycleChangeInputSchemaDefinition;
export type UserLifecycleChangeInput = z.infer<typeof userLifecycleChangeInputSchema>;

const userProfilesInputSchemaDefinition = z
  .object({ userIds: z.array(z.string().min(1)) })
  .strict();
export interface UserProfilesInputSchema extends Named<typeof userProfilesInputSchemaDefinition> {}
export const userProfilesInputSchema: UserProfilesInputSchema = userProfilesInputSchemaDefinition;
export type UserProfilesInput = z.infer<typeof userProfilesInputSchema>;

export const userEmailSchema = z.string().trim().pipe(z.email());
const userEmailInputSchemaDefinition = z.object({ email: userEmailSchema }).strict();
export interface UserEmailInputSchema extends Named<typeof userEmailInputSchemaDefinition> {}
export const userEmailInputSchema: UserEmailInputSchema = userEmailInputSchemaDefinition;
export type UserEmailInput = z.infer<typeof userEmailInputSchema>;

const createUserInputSchemaDefinition = z
  .object({ name: z.string(), email: userEmailSchema })
  .strict();
export interface CreateUserInputSchema extends Named<typeof createUserInputSchemaDefinition> {}
export const createUserInputSchema: CreateUserInputSchema = createUserInputSchemaDefinition;
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

const createCredentialUserInputSchemaDefinition = z
  .object({
    name: z.string().nullable(),
    email: userEmailSchema,
    passwordHash: z.string().min(1),
  })
  .strict();
export interface CreateCredentialUserInputSchema extends Named<
  typeof createCredentialUserInputSchemaDefinition
> {}
export const createCredentialUserInputSchema: CreateCredentialUserInputSchema =
  createCredentialUserInputSchemaDefinition;
export type CreateCredentialUserInput = z.infer<typeof createCredentialUserInputSchema>;

const createPasskeyUserInputSchemaDefinition = z.object({ email: userEmailSchema }).strict();
export interface CreatePasskeyUserInputSchema extends Named<
  typeof createPasskeyUserInputSchemaDefinition
> {}
export const createPasskeyUserInputSchema: CreatePasskeyUserInputSchema =
  createPasskeyUserInputSchemaDefinition;
export type CreatePasskeyUserInput = z.infer<typeof createPasskeyUserInputSchema>;

const createdUserSchemaDefinition = z.object({ id: z.string().min(1) }).strict();
export interface CreatedUserSchema extends Named<typeof createdUserSchemaDefinition> {}
export const createdUserSchema: CreatedUserSchema = createdUserSchemaDefinition;
export type CreatedUser = z.infer<typeof createdUserSchema>;

const setFirstUserPasswordInputSchemaDefinition = z
  .object({ id: z.string().min(1), passwordHash: z.string().min(1) })
  .strict();
export interface SetFirstUserPasswordInputSchema extends Named<
  typeof setFirstUserPasswordInputSchemaDefinition
> {}
export const setFirstUserPasswordInputSchema: SetFirstUserPasswordInputSchema =
  setFirstUserPasswordInputSchemaDefinition;
export type SetFirstUserPasswordInput = z.infer<typeof setFirstUserPasswordInputSchema>;

export const setFirstUserPasswordResultSchema = z.enum(["set", "already_set"]);
export type SetFirstUserPasswordResult = z.infer<typeof setFirstUserPasswordResultSchema>;

const userPasskeyNudgeStatusSchemaDefinition = z
  .object({
    hasPasskey: z.boolean(),
    /** Two-step verification is set up and confirmed on the account. */
    twoStepEnabled: z.boolean(),
    dismissedAt: z.date().nullable(),
    /** When the account was created, so the session that created it is told apart. */
    accountCreatedAt: z.date(),
  })
  .strict();
export interface UserPasskeyNudgeStatusSchema extends Named<
  typeof userPasskeyNudgeStatusSchemaDefinition
> {}
export const userPasskeyNudgeStatusSchema: UserPasskeyNudgeStatusSchema =
  userPasskeyNudgeStatusSchemaDefinition;
export type UserPasskeyNudgeStatus = z.infer<typeof userPasskeyNudgeStatusSchema>;

const userCredentialAccountRowSchemaDefinition = z
  .object({ password: z.string().nullable() })
  .strict();
export interface UserCredentialAccountRowSchema extends Named<
  typeof userCredentialAccountRowSchemaDefinition
> {}
export const userCredentialAccountRowSchema: UserCredentialAccountRowSchema =
  userCredentialAccountRowSchemaDefinition;

const userCredentialAccountSchemaDefinition = userCredentialAccountRowSchema
  .safeExtend({ id: z.string().min(1) })
  .strict();
export interface UserCredentialAccountSchema extends Named<
  typeof userCredentialAccountSchemaDefinition
> {}
export const userCredentialAccountSchema: UserCredentialAccountSchema =
  userCredentialAccountSchemaDefinition;

/** One sign-in method a person holds, as the settings list renders it. Never a secret. */
const userLinkedAccountSchemaDefinition = z
  .object({
    id: z.string().min(1),
    provider: z.string(),
    providerAccountId: z.string(),
  })
  .strict();
export interface UserLinkedAccountSchema extends Named<typeof userLinkedAccountSchemaDefinition> {}
export const userLinkedAccountSchema: UserLinkedAccountSchema = userLinkedAccountSchemaDefinition;
export type UserLinkedAccount = z.infer<typeof userLinkedAccountSchema>;

/**
 * What a password rotation did, or why it did nothing. Three outcomes rather
 * than three exceptions, because the door owes the reader a different sentence
 * for each and the account owes the door no opinion about status codes.
 */
export const userPasswordRotationOutcomeSchema = z.enum([
  "rotated",
  "no_password",
  "wrong_password",
]);
export type UserPasswordRotationOutcome = z.infer<typeof userPasswordRotationOutcomeSchema>;

/**
 * What adopting an unfinished account did. Each refusal leaves the account as
 * it was: `no_account`, an address that is `already_confirmed`, or one somebody
 * has `signed_in` to.
 */
export const adoptUnconfirmedAccountOutcomeSchema = z.enum([
  "adopted",
  "no_account",
  "already_confirmed",
  "signed_in",
]);
export type AdoptUnconfirmedAccountOutcome = z.infer<typeof adoptUnconfirmedAccountOutcomeSchema>;

/** What an unlink did. `last_account` is a refusal, not a failure. */
export const unlinkUserAccountOutcomeSchema = z.enum(["unlinked", "last_account", "not_found"]);
export type UnlinkUserAccountOutcome = z.infer<typeof unlinkUserAccountOutcomeSchema>;

const rotateUserPasswordInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
  })
  .strict();
export interface RotateUserPasswordInputSchema extends Named<
  typeof rotateUserPasswordInputSchemaDefinition
> {}
export const rotateUserPasswordInputSchema: RotateUserPasswordInputSchema =
  rotateUserPasswordInputSchemaDefinition;
export type RotateUserPasswordInput = z.infer<typeof rotateUserPasswordInputSchema>;

const unlinkUserAccountInputSchemaDefinition = z
  .object({ userId: z.string().min(1), accountId: z.string().min(1) })
  .strict();
export interface UnlinkUserAccountInputSchema extends Named<
  typeof unlinkUserAccountInputSchemaDefinition
> {}
export const unlinkUserAccountInputSchema: UnlinkUserAccountInputSchema =
  unlinkUserAccountInputSchemaDefinition;
export type UnlinkUserAccountInput = z.infer<typeof unlinkUserAccountInputSchema>;

const updateUserProfileInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
  })
  .strict();
export interface UpdateUserProfileInputSchema extends Named<
  typeof updateUserProfileInputSchemaDefinition
> {}
export const updateUserProfileInputSchema: UpdateUserProfileInputSchema =
  updateUserProfileInputSchemaDefinition;
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileInputSchema>;

const updateUserEmailInputSchemaDefinition = z
  .object({ id: z.string().min(1), email: userEmailSchema })
  .strict();
export interface UpdateUserEmailInputSchema extends Named<
  typeof updateUserEmailInputSchemaDefinition
> {}
export const updateUserEmailInputSchema: UpdateUserEmailInputSchema =
  updateUserEmailInputSchemaDefinition;
export type UpdateUserEmailInput = z.infer<typeof updateUserEmailInputSchema>;

const userAccountInfoSchemaDefinition = z.object({ createdAt: z.date() }).strict();
export interface UserAccountInfoSchema extends Named<typeof userAccountInfoSchemaDefinition> {}
export const userAccountInfoSchema: UserAccountInfoSchema = userAccountInfoSchemaDefinition;
export type UserAccountInfo = z.infer<typeof userAccountInfoSchema>;

const userSsoStatusSchemaDefinition = z.object({ pendingSsoSetup: z.boolean() }).strict();
export interface UserSsoStatusSchema extends Named<typeof userSsoStatusSchemaDefinition> {}
export const userSsoStatusSchema: UserSsoStatusSchema = userSsoStatusSchemaDefinition;
export type UserSsoStatus = z.infer<typeof userSsoStatusSchema>;

const userTourPreferenceSchemaDefinition = z
  .object({
    dismissed: z.boolean(),
    dismissedAt: z.date().nullable(),
  })
  .strict();
export interface UserTourPreferenceSchema extends Named<
  typeof userTourPreferenceSchemaDefinition
> {}
export const userTourPreferenceSchema: UserTourPreferenceSchema =
  userTourPreferenceSchemaDefinition;
export type UserTourPreference = z.infer<typeof userTourPreferenceSchema>;

/**
 * The topics a person can turn browser notifications on or off for. Each
 * feature that notifies names its own topic, so one choice never silences another.
 */
export const userNotificationTopicSchema = z.enum(["langy"]);
export type UserNotificationTopic = z.infer<typeof userNotificationTopicSchema>;

/** What a person answered about one topic's notifications. */
export const userNotificationChoiceSchema = z.enum(["enabled", "declined"]);
export type UserNotificationChoice = z.infer<typeof userNotificationChoiceSchema>;

/** One topic's stored choice; `choice` is null while the person never answered. */
const userNotificationPreferenceSchemaDefinition = z
  .object({
    topic: userNotificationTopicSchema,
    choice: userNotificationChoiceSchema.nullable(),
  })
  .strict();
export interface UserNotificationPreferenceSchema extends Named<
  typeof userNotificationPreferenceSchemaDefinition
> {}
export const userNotificationPreferenceSchema: UserNotificationPreferenceSchema =
  userNotificationPreferenceSchemaDefinition;
export type UserNotificationPreference = z.infer<typeof userNotificationPreferenceSchema>;

const userNotificationTopicInputSchemaDefinition = z
  .object({ id: z.string().min(1), topic: userNotificationTopicSchema })
  .strict();
export interface UserNotificationTopicInputSchema extends Named<
  typeof userNotificationTopicInputSchemaDefinition
> {}
export const userNotificationTopicInputSchema: UserNotificationTopicInputSchema =
  userNotificationTopicInputSchemaDefinition;
export type UserNotificationTopicInput = z.infer<typeof userNotificationTopicInputSchema>;

const setUserNotificationPreferenceInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    topic: userNotificationTopicSchema,
    choice: userNotificationChoiceSchema,
  })
  .strict();
export interface SetUserNotificationPreferenceInputSchema extends Named<
  typeof setUserNotificationPreferenceInputSchemaDefinition
> {}
export const setUserNotificationPreferenceInputSchema: SetUserNotificationPreferenceInputSchema =
  setUserNotificationPreferenceInputSchemaDefinition;
export type SetUserNotificationPreferenceInput = z.infer<
  typeof setUserNotificationPreferenceInputSchema
>;

const userTourPreferenceRowSchemaDefinition = z
  .object({ tracesExplorerTourDismissedAt: z.date().nullable() })
  .strict();
export interface UserTourPreferenceRowSchema extends Named<
  typeof userTourPreferenceRowSchemaDefinition
> {}
export const userTourPreferenceRowSchema: UserTourPreferenceRowSchema =
  userTourPreferenceRowSchemaDefinition;
const userHomePathSchemaDefinition = z.object({ lastHomePath: z.string().nullable() }).strict();
export interface UserHomePathSchema extends Named<typeof userHomePathSchemaDefinition> {}
export const userHomePathSchema: UserHomePathSchema = userHomePathSchemaDefinition;

const setUserHomePathInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1).max(1024).startsWith("/").nullable(),
  })
  .strict();
export interface SetUserHomePathInputSchema extends Named<
  typeof setUserHomePathInputSchemaDefinition
> {}
export const setUserHomePathInputSchema: SetUserHomePathInputSchema =
  setUserHomePathInputSchemaDefinition;
export type SetUserHomePathInput = z.infer<typeof setUserHomePathInputSchema>;

const setUserAvatarInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    imageDataUrl: z.string().min(1),
  })
  .strict();
export interface SetUserAvatarInputSchema extends Named<
  typeof setUserAvatarInputSchemaDefinition
> {}
export const setUserAvatarInputSchema: SetUserAvatarInputSchema =
  setUserAvatarInputSchemaDefinition;
export type SetUserAvatarInput = z.infer<typeof setUserAvatarInputSchema>;

const removeUserAvatarInputSchemaDefinition = z.object({ userId: z.string().min(1) }).strict();
export interface RemoveUserAvatarInputSchema extends Named<
  typeof removeUserAvatarInputSchemaDefinition
> {}
export const removeUserAvatarInputSchema: RemoveUserAvatarInputSchema =
  removeUserAvatarInputSchemaDefinition;
export type RemoveUserAvatarInput = z.infer<typeof removeUserAvatarInputSchema>;

const userAvatarResultSchemaDefinition = z.object({ image: z.string() }).strict();
export interface UserAvatarResultSchema extends Named<typeof userAvatarResultSchemaDefinition> {}
export const userAvatarResultSchema: UserAvatarResultSchema = userAvatarResultSchemaDefinition;
export type UserAvatarResult = z.infer<typeof userAvatarResultSchema>;

/** A same-origin signed URL an uploaded avatar renders from; it lapses after a few minutes. */
const userAvatarUrlSchemaDefinition = z.object({ url: z.string() }).strict();
export interface UserAvatarUrlSchema extends Named<typeof userAvatarUrlSchemaDefinition> {}
export const userAvatarUrlSchema: UserAvatarUrlSchema = userAvatarUrlSchemaDefinition;
export type UserAvatarUrl = z.infer<typeof userAvatarUrlSchema>;

/**
 * Who is asking. `id` is the SUBJECT — the account read and written, even
 * while an operator browses as them — and `operatorId` is whose preferences
 * and operator standing apply.
 */
const userCallerSchemaDefinition = z
  .object({
    id: z.string().min(1),
    operatorId: z.string().min(1),
    impersonated: z.boolean(),
  })
  .strict();
export interface UserCallerSchema extends Named<typeof userCallerSchemaDefinition> {}
export const userCallerSchema: UserCallerSchema = userCallerSchemaDefinition;
export type UserCaller = z.infer<typeof userCallerSchema>;

const registerCredentialAccountInputSchemaDefinition = z
  .object({
    name: z.string().nullable(),
    email: z.string().min(1),
    password: z.string().min(1),
    /** Spent before anything is written; the account exists only for a proven address. */
    addressProof: z.string().min(1),
    /** The caller's address, for the per-address signup budget. */
    callerAddress: z.string().min(1),
    /** The request's `Origin` and `Referer`, checked against the installation's address first. */
    origin: z.string().nullable(),
    referer: z.string().nullable(),
  })
  .strict();
export interface RegisterCredentialAccountInputSchema extends Named<
  typeof registerCredentialAccountInputSchemaDefinition
> {}
export const registerCredentialAccountInputSchema: RegisterCredentialAccountInputSchema =
  registerCredentialAccountInputSchemaDefinition;
export type RegisterCredentialAccountInput = z.infer<typeof registerCredentialAccountInputSchema>;

/** An account auth's register door cleared; `addressConfirmed` is what its spent proof proved. */
const credentialAccountInputSchemaDefinition = z
  .object({
    name: z.string().nullable(),
    email: z.string().min(1),
    password: z.string().min(1),
    addressConfirmed: z.boolean(),
  })
  .strict();
export interface CredentialAccountInputSchema extends Named<
  typeof credentialAccountInputSchemaDefinition
> {}
export const credentialAccountInputSchema: CredentialAccountInputSchema =
  credentialAccountInputSchemaDefinition;
export type CredentialAccountInput = z.infer<typeof credentialAccountInputSchema>;

/**
 * The session row a credential write keeps. Null while impersonating: the
 * row is the OPERATOR's, so "end every session but this one" would neither
 * keep the subject's tab nor mean anything about their devices.
 */
const keptBrowserSession = z.string().min(1).nullable();

/**
 * Who asked for a credential write, carried as a FACT rather than inferred.
 * `keepSessionId` is null both while impersonating and when no browser
 * session existed — different reasons. A refusal needs to be told, not guess.
 */
const credentialWriteCaller = userCallerSchema;

const setOwnFirstPasswordInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    password: z.string().min(1),
    keepSessionId: keptBrowserSession,
    caller: credentialWriteCaller,
  })
  .strict();
export interface SetOwnFirstPasswordInputSchema extends Named<
  typeof setOwnFirstPasswordInputSchemaDefinition
> {}
export const setOwnFirstPasswordInputSchema: SetOwnFirstPasswordInputSchema =
  setOwnFirstPasswordInputSchemaDefinition;
export type SetOwnFirstPasswordInput = z.infer<typeof setOwnFirstPasswordInputSchema>;

const changeOwnPasswordInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
    keepSessionId: keptBrowserSession,
    caller: credentialWriteCaller,
  })
  .strict();
export interface ChangeOwnPasswordInputSchema extends Named<
  typeof changeOwnPasswordInputSchemaDefinition
> {}
export const changeOwnPasswordInputSchema: ChangeOwnPasswordInputSchema =
  changeOwnPasswordInputSchemaDefinition;
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInputSchema>;

const setOwnAvatarInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    imageDataUrl: z.string().min(1),
  })
  .strict();
export interface SetOwnAvatarInputSchema extends Named<typeof setOwnAvatarInputSchemaDefinition> {}
export const setOwnAvatarInputSchema: SetOwnAvatarInputSchema = setOwnAvatarInputSchemaDefinition;
export type SetOwnAvatarInput = z.infer<typeof setOwnAvatarInputSchema>;

/**
 * The account-security offer (ADR-120, D06): whether to ask now, which halves
 * to offer, and how this session signed in — the screen asks only after a password.
 */
const userSecureAccountOfferSchemaDefinition = z
  .object({
    offer: z.boolean(),
    passkey: z.boolean(),
    twoStep: z.boolean(),
    signedInWith: z.enum(["password", "passkey", "federated", "unknown"]),
  })
  .strict();
export interface UserSecureAccountOfferSchema extends Named<
  typeof userSecureAccountOfferSchemaDefinition
> {}
export const userSecureAccountOfferSchema: UserSecureAccountOfferSchema =
  userSecureAccountOfferSchemaDefinition;
export type UserSecureAccountOffer = z.infer<typeof userSecureAccountOfferSchema>;

/** A display name as the account accepts it: trimmed, then 1-120 characters. */
export const userProfileNameSchema = z.string().trim().min(1).max(120);

/** What an avatar object carries beside its bytes. */
export type UserAvatarObjectMetadata = Readonly<{
  byteLength: number;
  mediaType: string;
  purpose: string;
  ownerKind: string;
}>;

/**
 * One avatar read, as the deployment's object store answers it. The bytes
 * arrive as a web stream, which is what the response carries.
 */
export type UserAvatarObjectRead =
  | Readonly<{
      status: "available";
      metadata: UserAvatarObjectMetadata;
      stream: ReadableStream;
    }>
  | Readonly<{ status: "missing"; metadata: UserAvatarObjectMetadata }>
  | null;
