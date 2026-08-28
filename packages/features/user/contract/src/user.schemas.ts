/**
 * The inputs the `user.*` tRPC surface publishes.
 *
 * They live in the contract rather than beside the router so the wire shape a
 * client is typed against is stated once, in the package both sides may import.
 *
 * Passwords appear here only as length bounds. The policy itself is checked in
 * the handler, where a refusal can carry `meta.fieldErrors` and land on the
 * field the person is looking at; a schema rejection arrives as a tRPC parse
 * error with no field to hang on. No schema here stores or echoes a secret.
 */
import { z } from "zod";

/**
 * The procedures that take no arguments still declare a parser, because tRPC
 * appends the input middleware where `.input()` is called and the process's
 * policy is applied after it.
 */
export const userApiEmptyInputSchema = z.object({});

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
  // A base64 image data URL (`data:image/...;base64,...`) produced by the
  // client crop/resize step. Deliberately NOT bounded with a `.max()` here:
  // `parseAvatarDataUrl` rejects at exactly the same ceiling before it scans
  // or decodes anything, so a `.max()` only wins the race and turns the
  // specific `avatar_image_too_large` ("Pick one under 8 MB") into the
  // anonymous `validation_error`. The point of that code is that both halves
  // of the check answer with it, whichever caught the file.
  imageDataUrl: z.string().min(1),
});

/** One organization, for the reads scoped to a whole tenant. */
export const userApiOrganizationInputSchema = z.object({ organizationId: z.string() });

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
