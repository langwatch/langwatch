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
  return userAvatarMediaTypeSchema.safeParse(mediaType).success
    ? mediaType
    : "application/octet-stream";
}

export const userProfileSchema = z
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
export type UserProfile = z.infer<typeof userProfileSchema>;

export const userFullProfileSchema = userProfileSchema
  .extend({
    lastHomePath: z.string().nullable(),
    tracesExplorerTourDismissedAt: z.date().nullable(),
  })
  .strict();
export type UserFullProfile = z.infer<typeof userFullProfileSchema>;

export const userIdInputSchema = z.object({ id: z.string().min(1) }).strict();
export type UserIdInput = z.infer<typeof userIdInputSchema>;

export const userProfilesInputSchema = z.object({ userIds: z.array(z.string().min(1)) }).strict();
export type UserProfilesInput = z.infer<typeof userProfilesInputSchema>;

export const userEmailSchema = z.string().trim().pipe(z.email());
export const userEmailInputSchema = z.object({ email: userEmailSchema }).strict();
export type UserEmailInput = z.infer<typeof userEmailInputSchema>;

export const createUserInputSchema = z
  .object({ name: z.string(), email: userEmailSchema })
  .strict();
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const createCredentialUserInputSchema = z
  .object({
    name: z.string().nullable(),
    email: userEmailSchema,
    passwordHash: z.string().min(1),
  })
  .strict();
export type CreateCredentialUserInput = z.infer<typeof createCredentialUserInputSchema>;

export const createPasskeyUserInputSchema = z.object({ email: userEmailSchema }).strict();
export type CreatePasskeyUserInput = z.infer<typeof createPasskeyUserInputSchema>;

export const createdUserSchema = z.object({ id: z.string().min(1) }).strict();
export type CreatedUser = z.infer<typeof createdUserSchema>;

export const setFirstUserPasswordInputSchema = z
  .object({ id: z.string().min(1), passwordHash: z.string().min(1) })
  .strict();
export type SetFirstUserPasswordInput = z.infer<typeof setFirstUserPasswordInputSchema>;

export const setFirstUserPasswordResultSchema = z.enum(["set", "already_set"]);
export type SetFirstUserPasswordResult = z.infer<typeof setFirstUserPasswordResultSchema>;

export const userPasskeyNudgeStatusSchema = z
  .object({ hasPasskey: z.boolean(), dismissedAt: z.date().nullable() })
  .strict();
export type UserPasskeyNudgeStatus = z.infer<typeof userPasskeyNudgeStatusSchema>;

export const userCredentialAccountRowSchema = z
  .object({ password: z.string().nullable() })
  .strict();

export const userCredentialAccountSchema = userCredentialAccountRowSchema
  .extend({ id: z.string().min(1) })
  .strict();

/** One sign-in method a person holds, as the settings list renders it. Never a secret. */
export const userLinkedAccountSchema = z
  .object({
    id: z.string().min(1),
    provider: z.string(),
    providerAccountId: z.string(),
  })
  .strict();
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

/** What an unlink did. `last_account` is a refusal, not a failure. */
export const unlinkUserAccountOutcomeSchema = z.enum(["unlinked", "last_account", "not_found"]);
export type UnlinkUserAccountOutcome = z.infer<typeof unlinkUserAccountOutcomeSchema>;

export const rotateUserPasswordInputSchema = z
  .object({
    userId: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
  })
  .strict();
export type RotateUserPasswordInput = z.infer<typeof rotateUserPasswordInputSchema>;

export const unlinkUserAccountInputSchema = z
  .object({ userId: z.string().min(1), accountId: z.string().min(1) })
  .strict();
export type UnlinkUserAccountInput = z.infer<typeof unlinkUserAccountInputSchema>;

export const updateUserProfileInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    email: userEmailSchema.optional(),
  })
  .strict();
export type UpdateUserProfileInput = z.infer<typeof updateUserProfileInputSchema>;

export const userAccountInfoSchema = z.object({ createdAt: z.date() }).strict();
export type UserAccountInfo = z.infer<typeof userAccountInfoSchema>;

export const userSsoStatusSchema = z.object({ pendingSsoSetup: z.boolean() }).strict();
export type UserSsoStatus = z.infer<typeof userSsoStatusSchema>;

export const userTourPreferenceSchema = z
  .object({
    dismissed: z.boolean(),
    dismissedAt: z.date().nullable(),
  })
  .strict();
export type UserTourPreference = z.infer<typeof userTourPreferenceSchema>;

export const userTourPreferenceRowSchema = z
  .object({ tracesExplorerTourDismissedAt: z.date().nullable() })
  .strict();
export const userHomePathSchema = z.object({ lastHomePath: z.string().nullable() }).strict();

export const setUserHomePathInputSchema = z
  .object({
    id: z.string().min(1),
    path: z.string().min(1).max(1024).startsWith("/").nullable(),
  })
  .strict();
export type SetUserHomePathInput = z.infer<typeof setUserHomePathInputSchema>;

export const setUserAvatarInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    imageDataUrl: z.string().min(1),
    displayName: z.string().nullable().optional(),
    displayEmail: z.string().nullable().optional(),
  })
  .strict();
export type SetUserAvatarInput = z.infer<typeof setUserAvatarInputSchema>;

export const removeUserAvatarInputSchema = z.object({ userId: z.string().min(1) }).strict();
export type RemoveUserAvatarInput = z.infer<typeof removeUserAvatarInputSchema>;

export const userAvatarResultSchema = z.object({ image: z.string() }).strict();
export type UserAvatarResult = z.infer<typeof userAvatarResultSchema>;

/**
 * What a completed email-verification ceremony answers.
 *
 * Deliberately one flag and nothing else: the caller already knows which
 * identifier they were verifying, and the ceremony has no other fact to hand
 * back that is not already theirs.
 */
export const identityVerificationCompletedSchema = z.object({ verified: z.literal(true) }).strict();
export type IdentityVerificationCompleted = z.infer<typeof identityVerificationCompletedSchema>;
export type UserVerificationCompleted = IdentityVerificationCompleted;

export const completeUserVerificationInputSchema = z
  .object({
    userId: z.string().min(1),
    identifierId: z.string().min(1),
    verificationId: z.string().min(1),
    token: z.string().min(1),
    codeVerifier: z.string().min(1),
  })
  .strict();
export type CompleteUserVerificationInput = z.infer<typeof completeUserVerificationInputSchema>;

/**
 * Who is asking. `id` is the SUBJECT — the account read and written, even
 * while an operator browses as them — and `operatorId` is whose preferences
 * and operator standing apply.
 */
export const userCallerSchema = z
  .object({
    id: z.string().min(1),
    operatorId: z.string().min(1),
    impersonated: z.boolean(),
  })
  .strict();
export type UserCaller = z.infer<typeof userCallerSchema>;

export const registerCredentialAccountInputSchema = z
  .object({
    name: z.string().nullable(),
    email: z.string().min(1),
    password: z.string().min(1),
    /** The caller's address, for the per-address signup budget. */
    callerAddress: z.string().min(1),
  })
  .strict();
export type RegisterCredentialAccountInput = z.infer<typeof registerCredentialAccountInputSchema>;

/**
 * The session row a credential write keeps. Null while an operator is
 * impersonating: the row is the OPERATOR's, so "end every session but this
 * one" would neither keep the subject's tab nor mean anything about their
 * devices.
 */
const keptBrowserSession = z.string().min(1).nullable();

export const setOwnFirstPasswordInputSchema = z
  .object({
    userId: z.string().min(1),
    password: z.string().min(1),
    keepSessionId: keptBrowserSession,
  })
  .strict();
export type SetOwnFirstPasswordInput = z.infer<typeof setOwnFirstPasswordInputSchema>;

export const changeOwnPasswordInputSchema = z
  .object({
    userId: z.string().min(1),
    currentPassword: z.string().min(1),
    newPassword: z.string().min(1),
    keepSessionId: keptBrowserSession,
  })
  .strict();
export type ChangeOwnPasswordInput = z.infer<typeof changeOwnPasswordInputSchema>;

export const setOwnAvatarInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    imageDataUrl: z.string().min(1),
  })
  .strict();
export type SetOwnAvatarInput = z.infer<typeof setOwnAvatarInputSchema>;

/** Whether this deployment still owes the person a passkey offer today. */
export const userPasskeyOfferSchema = z.object({ offer: z.boolean() }).strict();
export type UserPasskeyOffer = z.infer<typeof userPasskeyOfferSchema>;

/** What one count of a caller's avatar reads answers. */
export type UserAvatarReadAllowance = Readonly<{ allowed: boolean; resetAt: number }>;

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
