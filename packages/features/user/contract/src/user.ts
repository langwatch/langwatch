import { z } from "zod";

export const USER_FEATURE_ID = "user" as const;
export const USER_AVATAR_PURPOSE = "user_avatar" as const;
export const USER_AVATAR_OWNER_KIND = "user" as const;
export const USER_AVATAR_MAX_BYTES = 8 * 1024 * 1024;
export const USER_AVATAR_MAX_DATA_URL_LENGTH =
  Math.ceil(USER_AVATAR_MAX_BYTES / 3) * 4 + 256;
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

export const userProfilesInputSchema = z
  .object({ userIds: z.array(z.string().min(1)) })
  .strict();
export type UserProfilesInput = z.infer<typeof userProfilesInputSchema>;

export const userEmailSchema = z.string().trim().pipe(z.email());
export const userEmailInputSchema = z.object({ email: userEmailSchema }).strict();
export type UserEmailInput = z.infer<typeof userEmailInputSchema>;

export const createUserInputSchema = z
  .object({ name: z.string(), email: userEmailSchema })
  .strict();
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

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

export const removeUserAvatarInputSchema = z
  .object({ userId: z.string().min(1) })
  .strict();
export type RemoveUserAvatarInput = z.infer<typeof removeUserAvatarInputSchema>;

export const userAvatarResultSchema = z.object({ image: z.string() }).strict();
export type UserAvatarResult = z.infer<typeof userAvatarResultSchema>;
