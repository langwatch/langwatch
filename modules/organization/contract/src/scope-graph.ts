import type { Named } from "@langwatch/module";
/**
 * The organization, team and project skeleton the browser resolves a scope against,
 * narrowed to the caller: `organization.getScopeGraph`. Credentials and
 * settings-only fields stay out; the shapes match `ui-scope.ts`, plus the chrome's scalars.
 */
import { z } from "zod";

import { organizationIntentSchema } from "./organization.ts";

const scopeGraphProjectSchemaDefinition = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  kind: z.string(),
  userLinkTemplate: z.string().nullable(),
  presenceEnabled: z.boolean(),
  lastCodingAgentSessionAt: z.date().nullable(),
  lastCodingAgentPullRequestAt: z.date().nullable(),
});
export interface ScopeGraphProjectSchema extends Named<typeof scopeGraphProjectSchemaDefinition> {}
export const scopeGraphProjectSchema: ScopeGraphProjectSchema = scopeGraphProjectSchemaDefinition;
export type ScopeGraphProject = z.infer<typeof scopeGraphProjectSchema>;

const scopeGraphTeamSchemaDefinition = z.object({
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
export interface ScopeGraphTeamSchema extends Named<typeof scopeGraphTeamSchemaDefinition> {}
export const scopeGraphTeamSchema: ScopeGraphTeamSchema = scopeGraphTeamSchemaDefinition;
export type ScopeGraphTeam = z.infer<typeof scopeGraphTeamSchema>;

const scopeGraphOrganizationSchemaDefinition = z.object({
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
export interface ScopeGraphOrganizationSchema extends Named<
  typeof scopeGraphOrganizationSchemaDefinition
> {}
export const scopeGraphOrganizationSchema: ScopeGraphOrganizationSchema =
  scopeGraphOrganizationSchemaDefinition;
export type ScopeGraphOrganization = z.infer<typeof scopeGraphOrganizationSchema>;

/** The read takes no arguments. */
const organizationApiScopeGraphInputSchemaDefinition = z.object({});
export interface OrganizationApiScopeGraphInputSchema extends Named<
  typeof organizationApiScopeGraphInputSchemaDefinition
> {}
export const organizationApiScopeGraphInputSchema: OrganizationApiScopeGraphInputSchema =
  organizationApiScopeGraphInputSchemaDefinition;

/** What the handler returns. */
const scopeGraphSchemaDefinition = z.array(scopeGraphOrganizationSchema);
export interface ScopeGraphSchema extends Named<typeof scopeGraphSchemaDefinition> {}
export const scopeGraphSchema: ScopeGraphSchema = scopeGraphSchemaDefinition;
