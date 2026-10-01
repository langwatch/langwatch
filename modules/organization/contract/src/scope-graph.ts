/**
 * The organization, team and project skeleton the browser resolves a scope against,
 * narrowed to the caller: `organization.getScopeGraph`, a versioned read. Credentials and
 * settings-only fields stay out; the shapes match `ui-scope.ts`, plus the chrome's scalars.
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

/** The read takes no arguments of its own; the host adds `since` (a versioned read). */
export const organizationApiScopeGraphInputSchema = z.object({});

/** What the handler returns; the wire carries it inside the versioned envelope. */
export const scopeGraphSchema = z.array(scopeGraphOrganizationSchema);
