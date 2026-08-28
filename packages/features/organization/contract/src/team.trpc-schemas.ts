import { z } from "zod";
import { organizationTeamMemberInputSchema } from "./team";

/**
 * The transport inputs the team surface publishes. A team belongs to exactly
 * one organization, so its transport contract lives beside the
 * organization's. The organization scope two of these reads carry is
 * `organizationApiScopeSchema`, in `organization.api.ts`.
 */

/** A team addressed by its slug within an organization. */
export const teamApiSlugSchema = z.object({
  organizationId: z.string(),
  slug: z.string(),
});
export type TeamApiSlug = z.infer<typeof teamApiSlugSchema>;

/**
 * The same pair the other way round. Kept distinct from `teamApiSlugSchema`
 * because the two procedures that take it were published with the keys in this
 * order, and an input shape is what a client is typed against.
 */
export const teamApiSlugWithOrganizationSchema = z.object({
  slug: z.string(),
  organizationId: z.string(),
});
export type TeamApiSlugWithOrganization = z.infer<typeof teamApiSlugWithOrganizationSchema>;

export const teamApiUpdateInputSchema = z.object({
  teamId: z.string(),
  name: z.string(),
  members: z.array(organizationTeamMemberInputSchema),
});
export type TeamApiUpdateInput = z.infer<typeof teamApiUpdateInputSchema>;

export const teamApiCreateWithMembersInputSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  members: z.array(organizationTeamMemberInputSchema),
});
export type TeamApiCreateWithMembersInput = z.infer<typeof teamApiCreateWithMembersInputSchema>;

export const teamApiTeamScopeSchema = z.object({ teamId: z.string() });
export type TeamApiTeamScope = z.infer<typeof teamApiTeamScopeSchema>;

export const teamApiRemoveMemberInputSchema = z.object({
  teamId: z.string(),
  userId: z.string(),
});
export type TeamApiRemoveMemberInput = z.infer<typeof teamApiRemoveMemberInputSchema>;
