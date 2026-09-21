/** Response schemas for the `user.*` tRPC surface. */
import { ensuredPersonalWorkspaceSchema } from "@langwatch/organization-contract";
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

/** Whether to offer this person a passkey right now (ADR-120). */
export const userApiPasskeyNudgeSchema = z.object({ offer: z.boolean() }).strict();

/** One sign-in method linked to the account. Never a secret. */
export const userApiLinkedAccountSchema = z
  .object({
    id: z.string(),
    provider: z.string(),
    providerAccountId: z.string(),
  })
  .strict();

export const userApiLinkedAccountsSchema = z.array(userApiLinkedAccountSchema);

/**
 * The caller's personal workspace inside one organization, plus the routing
 * policy it inherits by default. Null where the organization declares none.
 */
export const userApiPersonalContextSchema = z
  .object({
    workspace: ensuredPersonalWorkspaceSchema,
    routingPolicy: z.object({ id: z.string(), name: z.string() }).strict().nullable(),
  })
  .strict();

/**
 * The budget banner's state — two shapes, and the bare one is not a
 * degenerate case of the other: it is what a caller with no personal
 * workspace, no virtual key, or no analytics store gets — no budget to describe.
 */
export const userApiPersonalBudgetSchema = z.union([
  z.object({ status: z.literal("ok") }).strict(),
  z
    .object({
      status: z.enum(["ok", "warning", "exceeded"]),
      scope: z.string(),
      spentUsd: z.string(),
      limitUsd: z.string(),
      period: z.string(),
      /** Absent when the deployment publishes no base URL to link to. */
      requestIncreaseUrl: z.string().optional(),
      adminEmail: z.string().nullable(),
    })
    .strict(),
]);

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

export type UserPersonalContext = z.infer<typeof userApiPersonalContextSchema>;
export type UserPersonalBudget = z.infer<typeof userApiPersonalBudgetSchema>;
export type UserBudgetIncreaseRequested = z.infer<typeof userApiBudgetIncreaseRequestedSchema>;
export type UserHomePagePickerState = z.infer<typeof userApiHomePagePickerStateSchema>;

/**
 * One browser this person is signed in on, as the `/me` devices list reads it.
 * Auth owns the session rows; this is the shape the account surface serves, so
 * the two are typechecked against each other rather than assumed identical.
 */
export const userApiBrowserSessionSchema = z
  .object({
    sessionId: z.string().min(1),
    /** Which sign-in method minted it; null on every session predating it. */
    identifierId: z.string().nullable(),
    /** How it signed in, in words — never `pwd` or `phw`. */
    method: z.string().min(1),
    secondFactorProven: z.boolean(),
    ipAddress: z.string().nullable(),
    userAgent: z.string().nullable(),
    signedInAt: z.string().datetime(),
    /** Activity to the nearest day: better-auth rolls a live session's expiry
     *  once per `updateAge`, and that is all this is asked to tell apart. */
    lastActiveAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    /** Whether this is the session doing the reading. */
    current: z.boolean(),
  })
  .strict();
export type UserBrowserSession = z.infer<typeof userApiBrowserSessionSchema>;

/** How many sessions an end request actually ended; zero is an ordinary answer. */
export const userApiBrowserSessionEndedSchema = z
  .object({ ended: z.number().int().nonnegative() })
  .strict();
export type UserBrowserSessionEnded = z.infer<typeof userApiBrowserSessionEndedSchema>;
