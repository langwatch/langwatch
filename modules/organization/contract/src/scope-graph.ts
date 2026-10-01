/**
 * The organization, team and project skeleton the browser resolves a scope against,
 * narrowed to the caller: `organization.getScopeGraph`. Credentials and settings-only
 * fields stay out; the shapes match `ui-scope.ts`, plus the chrome's scalars.
 */
import { z } from "zod";

import { organizationIntentSchema } from "./organization.ts";

export const scopeGraphProjectSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  userLinkTemplate: z.string().nullable(),
  presenceEnabled: z.boolean(),
  lastCodingAgentSessionAt: z.date().nullable(),
  lastCodingAgentPullRequestAt: z.date().nullable(),
});
export type ScopeGraphProject = z.infer<typeof scopeGraphProjectSchema>;

export const scopeGraphTeamSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  isPersonal: z.boolean(),
  ownerUserId: z.string().nullable(),
  /** The user whose personal team this is, else null; an admin opening it is audited. */
  personalOf: z.string().nullable(),
  /** The caller's own row, stored or synthesised from a binding; empty when neither. */
  members: z.array(z.object({ userId: z.string() })),
  projects: z.array(scopeGraphProjectSchema),
});
export type ScopeGraphTeam = z.infer<typeof scopeGraphTeamSchema>;

export const scopeGraphOrganizationSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  primaryIntent: organizationIntentSchema.nullable(),
  presenceEnabled: z.boolean(),
  pricingModel: z.enum(["TIERED", "SEAT_EVENT"]),
  ssoProvider: z.string().nullable(),
  /** The caller's own membership role; empty when only a binding reaches it. */
  members: z.array(z.object({ role: z.string() })),
  teams: z.array(scopeGraphTeamSchema),
});
export type ScopeGraphOrganization = z.infer<typeof scopeGraphOrganizationSchema>;

/** `since` is the version the browser holds; a match answers `unchanged`. */
export const organizationApiScopeGraphInputSchema = z.object({ since: z.string().optional() });
export type OrganizationApiScopeGraphInput = z.infer<typeof organizationApiScopeGraphInputSchema>;

export const scopeGraphAnswerSchema = z.union([
  z.object({ unchanged: z.literal(true) }),
  z.object({ version: z.string(), graph: z.array(scopeGraphOrganizationSchema) }),
]);
export type ScopeGraphAnswer = z.infer<typeof scopeGraphAnswerSchema>;
