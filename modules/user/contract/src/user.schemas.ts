/** Input schemas for the `user.*` tRPC surface. Secrets never stored here. */
import { z } from "zod";

import { userProfileNameSchema } from "./user.ts";

/**
 * The procedures that take no arguments still declare a parser, because tRPC
 * appends the input middleware where `.input()` is called and the process's
 * policy is applied after it.
 */
export const userApiEmptyInputSchema = z.object({});

/** A blank name is refused here, not trimmed down to nothing and stored. */
export const userApiUpdateNameInputSchema = z.object({ name: userProfileNameSchema });

export const userApiRegisterInputSchema = z.object({
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
});

export const userApiUnlinkAccountInputSchema = z.object({ accountId: z.string() });

/** Which of the caller's own browser sessions to end. */
export const userApiEndBrowserSessionInputSchema = z
  .object({ sessionId: z.string().min(1) })
  .strict();

export const userApiSetPasswordInputSchema = z.object({ password: z.string().min(1) });

export const userApiChangePasswordInputSchema = z.object({
  // Required for both modes — the user must re-confirm their current
  // password to change it. Defends against a stolen session lock-out: even
  // with a valid session cookie, an attacker can't change the password
  // without knowing the existing one.
  currentPassword: z.string().min(1, "Current password is required"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
});

/** One user, for the procedures that name a person other than the caller. */
export const userApiUserInputSchema = z.object({ userId: z.string() });

export const userApiSetAvatarInputSchema = z.object({
  organizationId: z.string(),
  // A base64 image data URL (`data:image/...;base64,...`) from the client
  // crop/resize step. Deliberately NOT bounded with `.max()`: `parseAvatarDataUrl`
  // rejects at the same ceiling first, so both halves answer with the
  // specific `avatar_image_too_large` rather than turning it into `validation_error`.
  imageDataUrl: z.string().min(1),
});

/** One organization, for the reads scoped to a whole tenant. */
export const userApiOrganizationInputSchema = z.object({ organizationId: z.string() });

/** Defaults to the start of this month through now unless both ends are given. */
export const userApiPersonalUsageInputSchema = z.object({
  organizationId: z.string(),
  windowStartMs: z.number().optional(),
  windowEndMs: z.number().optional(),
});

export const userApiBudgetOverviewInputSchema = z.object({
  organizationId: z.string(),
  includeTopModels: z.boolean().optional(),
});

export const userApiRequestBudgetIncreaseInputSchema = z.object({
  organizationId: z.string(),
  scope: z.string(),
  scopeId: z.string(),
  limitUsd: z.string(),
  spentUsd: z.string(),
  period: z.string().optional(),
  message: z.string().max(2000).optional(),
});

export const userApiSetLastHomePathInputSchema = z.object({
  path: z.string().min(1).max(1024).regex(/^\//, "must start with /").nullable(),
});

/**
 * The two proofs an email verification must present together: the emailed
 * single-use token, and the PKCE verifier held by the context that STARTED the
 * ceremony. A forwarded link carries only the first and verifies nothing.
 */
export const userApiCompleteVerificationInputSchema = z.object({
  identifierId: z.string().min(1),
  verificationId: z.string().min(1),
  token: z.string().min(1),
  // RFC 7636 §4.1: 43-128 characters from the unreserved set.
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

export type UserApiEmptyInput = z.infer<typeof userApiEmptyInputSchema>;
export type UserApiRegisterInput = z.infer<typeof userApiRegisterInputSchema>;
export type UserApiUnlinkAccountInput = z.infer<typeof userApiUnlinkAccountInputSchema>;
export type UserApiSetPasswordInput = z.infer<typeof userApiSetPasswordInputSchema>;
export type UserApiChangePasswordInput = z.infer<typeof userApiChangePasswordInputSchema>;
export type UserApiUserInput = z.infer<typeof userApiUserInputSchema>;
export type UserApiSetAvatarInput = z.infer<typeof userApiSetAvatarInputSchema>;
export type UserApiOrganizationInput = z.infer<typeof userApiOrganizationInputSchema>;
export type UserApiPersonalUsageInput = z.infer<typeof userApiPersonalUsageInputSchema>;
export type UserApiBudgetOverviewInput = z.infer<typeof userApiBudgetOverviewInputSchema>;
export type UserApiRequestBudgetIncreaseInput = z.infer<
  typeof userApiRequestBudgetIncreaseInputSchema
>;
export type UserApiSetLastHomePathInput = z.infer<typeof userApiSetLastHomePathInputSchema>;
export type UserApiCompleteVerificationInput = z.infer<
  typeof userApiCompleteVerificationInputSchema
>;
