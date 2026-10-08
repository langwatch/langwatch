/** Response schemas for the `user.*` tRPC surface. */
import { z } from "zod";

/**
 * The acknowledgement the account and credential writes answer with — kept
 * as one schema because it is one word: the caller asked for something to
 * happen and it happened. A refusal is an error, never `success: false`.
 */
export const userApiSuccessSchema = z.object({ success: z.literal(true) }).strict();

/** The acknowledgement the /me dashboard's writes answer with. */
export const userApiOkSchema = z.object({ ok: z.literal(true) }).strict();

/** Whether the caller is on the platform admin list. Not an access gate. */
export const userApiIsAdminSchema = z.object({ isAdmin: z.boolean() }).strict();

/** Whether the caller can sign in with a password at all. */
export const userApiHasPasswordSchema = z.object({ hasPassword: z.boolean() }).strict();

/** The display name the account now carries. */
export const userApiUpdatedNameSchema = z.object({ name: z.string() }).strict();

/** One sign-in method linked to the account. Never a secret. */
export const userApiLinkedAccountSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    providerAccountId: z.string(),
  })
  .strict();

export const userApiLinkedAccountsSchema = z.array(userApiLinkedAccountSchema);

/** Who the budget-increase request was mailed to. */
export const userApiBudgetIncreaseRequestedSchema = z
  .object({ ok: z.literal(true), sentTo: z.string() })
  .strict();

/** The home-page picker's one round trip: the pin, and where auto-detect lands. */
export const userApiHomePagePickerStateSchema = z
  .object({
    lastHomePath: z.string().nullable(),
    firstProjectSlug: z.string().nullable(),
  })
  .strict();

export type UserBudgetIncreaseRequested = z.infer<typeof userApiBudgetIncreaseRequestedSchema>;
export type UserHomePagePickerState = z.infer<typeof userApiHomePagePickerStateSchema>;
