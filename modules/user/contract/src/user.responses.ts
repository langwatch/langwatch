import type { Named } from "@langwatch/module";
/** Response schemas for the `user.*` tRPC surface. */
import { z } from "zod";

/**
 * The acknowledgement the account and credential writes answer with — kept
 * as one schema because it is one word: the caller asked for something to
 * happen and it happened. A refusal is an error, never `success: false`.
 */
const userApiSuccessSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface UserApiSuccessSchema extends Named<typeof userApiSuccessSchemaDefinition> {}
export const userApiSuccessSchema: UserApiSuccessSchema = userApiSuccessSchemaDefinition;

/** The acknowledgement the /me dashboard's writes answer with. */
const userApiOkSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface UserApiOkSchema extends Named<typeof userApiOkSchemaDefinition> {}
export const userApiOkSchema: UserApiOkSchema = userApiOkSchemaDefinition;

/** Whether the caller is on the platform admin list. Not an access gate. */
const userApiIsAdminSchemaDefinition = z.object({ isAdmin: z.boolean() }).strict();
export interface UserApiIsAdminSchema extends Named<typeof userApiIsAdminSchemaDefinition> {}
export const userApiIsAdminSchema: UserApiIsAdminSchema = userApiIsAdminSchemaDefinition;

/** Whether the caller can sign in with a password at all. */
const userApiHasPasswordSchemaDefinition = z.object({ hasPassword: z.boolean() }).strict();
export interface UserApiHasPasswordSchema extends Named<
  typeof userApiHasPasswordSchemaDefinition
> {}
export const userApiHasPasswordSchema: UserApiHasPasswordSchema =
  userApiHasPasswordSchemaDefinition;

/** The display name the account now carries. */
const userApiUpdatedNameSchemaDefinition = z.object({ name: z.string() }).strict();
export interface UserApiUpdatedNameSchema extends Named<
  typeof userApiUpdatedNameSchemaDefinition
> {}
export const userApiUpdatedNameSchema: UserApiUpdatedNameSchema =
  userApiUpdatedNameSchemaDefinition;

/** One sign-in method linked to the account. Never a secret. */
const userApiLinkedAccountSchemaDefinition = z
  .object({
    id: z.string(),
    provider: z.string(),
    providerAccountId: z.string(),
  })
  .strict();
export interface UserApiLinkedAccountSchema extends Named<
  typeof userApiLinkedAccountSchemaDefinition
> {}
export const userApiLinkedAccountSchema: UserApiLinkedAccountSchema =
  userApiLinkedAccountSchemaDefinition;

const userApiLinkedAccountsSchemaDefinition = z.array(userApiLinkedAccountSchema);
export interface UserApiLinkedAccountsSchema extends Named<
  typeof userApiLinkedAccountsSchemaDefinition
> {}
export const userApiLinkedAccountsSchema: UserApiLinkedAccountsSchema =
  userApiLinkedAccountsSchemaDefinition;

/** Who the budget-increase request was mailed to. */
const userApiBudgetIncreaseRequestedSchemaDefinition = z
  .object({ ok: z.literal(true), sentTo: z.string() })
  .strict();
export interface UserApiBudgetIncreaseRequestedSchema extends Named<
  typeof userApiBudgetIncreaseRequestedSchemaDefinition
> {}
export const userApiBudgetIncreaseRequestedSchema: UserApiBudgetIncreaseRequestedSchema =
  userApiBudgetIncreaseRequestedSchemaDefinition;

/** The home-page picker's one round trip: the pin, and where auto-detect lands. */
const userApiHomePagePickerStateSchemaDefinition = z
  .object({
    lastHomePath: z.string().nullable(),
    firstProjectSlug: z.string().nullable(),
  })
  .strict();
export interface UserApiHomePagePickerStateSchema extends Named<
  typeof userApiHomePagePickerStateSchemaDefinition
> {}
export const userApiHomePagePickerStateSchema: UserApiHomePagePickerStateSchema =
  userApiHomePagePickerStateSchemaDefinition;

export type UserBudgetIncreaseRequested = z.infer<typeof userApiBudgetIncreaseRequestedSchema>;
export type UserHomePagePickerState = z.infer<typeof userApiHomePagePickerStateSchema>;
