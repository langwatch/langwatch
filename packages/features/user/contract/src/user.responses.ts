/**
 * What the `user.*` tRPC surface ANSWERS.
 *
 * The inputs already lived in `user.schemas.ts`; these are the other half, so
 * every procedure can state its response shape the way it states its request
 * one. They are the transport's shapes rather than the service's: several
 * procedures answer an acknowledgement the service itself never mentions
 * (`{ success: true }`), and the ones that forward a service value reuse that
 * value's own schema instead of restating it.
 */
import { ensuredPersonalWorkspaceSchema } from "@langwatch/organization-contract";
import { z } from "zod";

/**
 * The acknowledgement the account and credential writes answer with.
 *
 * Kept as one schema because it is one word: the caller asked for something to
 * happen and it happened. A refusal is an error, never a `success: false`.
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
 * The budget banner's state.
 *
 * Two shapes, and the bare one is not a degenerate case of the other: it is
 * what a caller with no personal workspace, no virtual key or no analytics
 * store gets, where there is no budget to describe at all.
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
