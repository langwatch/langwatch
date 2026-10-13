import type { Named } from "@langwatch/module";
import { z } from "zod";

import { organizationTeamMemberInputSchema } from "./team.ts";

/**
 * The transport inputs the team surface publishes; two of these reads also
 * carry `organizationApiScopeSchema` from `organization.api.ts`.
 */

/** A team addressed by its slug within an organization. */
const teamApiSlugSchemaDefinition = z.object({
  organizationId: z.string(),
  slug: z.string(),
});
export interface TeamApiSlugSchema extends Named<typeof teamApiSlugSchemaDefinition> {}
export const teamApiSlugSchema: TeamApiSlugSchema = teamApiSlugSchemaDefinition;
export type TeamApiSlug = z.infer<typeof teamApiSlugSchema>;

/**
 * The same pair the other way round. Kept distinct from `teamApiSlugSchema`
 * because the two procedures that take it were published with the keys in this
 * order, and an input shape is what a client is typed against.
 */
const teamApiSlugWithOrganizationSchemaDefinition = z.object({
  slug: z.string(),
  organizationId: z.string(),
});
export interface TeamApiSlugWithOrganizationSchema extends Named<
  typeof teamApiSlugWithOrganizationSchemaDefinition
> {}
export const teamApiSlugWithOrganizationSchema: TeamApiSlugWithOrganizationSchema =
  teamApiSlugWithOrganizationSchemaDefinition;
export type TeamApiSlugWithOrganization = z.infer<typeof teamApiSlugWithOrganizationSchema>;

const teamApiUpdateInputSchemaDefinition = z.object({
  teamId: z.string(),
  name: z.string(),
  members: z.array(organizationTeamMemberInputSchema),
});
export interface TeamApiUpdateInputSchema extends Named<
  typeof teamApiUpdateInputSchemaDefinition
> {}
export const teamApiUpdateInputSchema: TeamApiUpdateInputSchema =
  teamApiUpdateInputSchemaDefinition;
export type TeamApiUpdateInput = z.infer<typeof teamApiUpdateInputSchema>;

const teamApiCreateWithMembersInputSchemaDefinition = z.object({
  organizationId: z.string(),
  name: z.string(),
  members: z.array(organizationTeamMemberInputSchema),
});
export interface TeamApiCreateWithMembersInputSchema extends Named<
  typeof teamApiCreateWithMembersInputSchemaDefinition
> {}
export const teamApiCreateWithMembersInputSchema: TeamApiCreateWithMembersInputSchema =
  teamApiCreateWithMembersInputSchemaDefinition;
export type TeamApiCreateWithMembersInput = z.infer<typeof teamApiCreateWithMembersInputSchema>;

const teamApiTeamScopeSchemaDefinition = z.object({ teamId: z.string() });
export interface TeamApiTeamScopeSchema extends Named<typeof teamApiTeamScopeSchemaDefinition> {}
export const teamApiTeamScopeSchema: TeamApiTeamScopeSchema = teamApiTeamScopeSchemaDefinition;
export type TeamApiTeamScope = z.infer<typeof teamApiTeamScopeSchema>;

const teamApiRemoveMemberInputSchemaDefinition = z.object({
  teamId: z.string(),
  userId: z.string(),
});
export interface TeamApiRemoveMemberInputSchema extends Named<
  typeof teamApiRemoveMemberInputSchemaDefinition
> {}
export const teamApiRemoveMemberInputSchema: TeamApiRemoveMemberInputSchema =
  teamApiRemoveMemberInputSchemaDefinition;
export type TeamApiRemoveMemberInput = z.infer<typeof teamApiRemoveMemberInputSchema>;
