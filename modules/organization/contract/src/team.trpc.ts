/**
 * Every `team.*` procedure, declared once. A team belongs to one organization,
 * so the organization module owns the namespace: `organization:view` reads,
 * `team:manage` administers, `organization:manage` creates.
 */

import { defineTrpcContract } from "@langwatch/api/contract";

import { organizationApiScopeSchema } from "./organization.trpc-schemas.ts";
import { organizationTeamAccessSchema, organizationTeamSchema } from "./team.ts";
import {
  teamMemberRemovedSchema,
  teamWithProjectsSchema,
  teamWriteAckSchema,
} from "./team.responses.ts";
import {
  teamApiCreateWithMembersInputSchema,
  teamApiRemoveMemberInputSchema,
  teamApiSlugSchema,
  teamApiSlugWithOrganizationSchema,
  teamApiTeamScopeSchema,
  teamApiUpdateInputSchema,
} from "./team.trpc-schemas.ts";

export const teamTrpc = defineTrpcContract("team")
  .query("getBySlug")
  .withInput(teamApiSlugSchema)
  .withOutput(organizationTeamSchema)

  /** Every team the caller can see, with the projects that sit in each. */
  .query("getTeamsWithMembers")
  .withInput(organizationApiScopeSchema)
  .withOutput(teamWithProjectsSchema.array())

  /** The access matrix an administrator edits: who holds what, and through what. */
  .query("getTeamsWithRoleBindings")
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationTeamAccessSchema.array())

  .query("getTeamWithMembers")
  .withInput(teamApiSlugWithOrganizationSchema)
  .withOutput(teamWithProjectsSchema)

  .mutation("update")
  .withInput(teamApiUpdateInputSchema)
  .withOutput(teamWriteAckSchema)

  .mutation("createTeamWithMembers")
  .withInput(teamApiCreateWithMembersInputSchema)
  .withOutput(organizationTeamSchema)

  .mutation("archiveById")
  .withInput(teamApiTeamScopeSchema)
  .withOutput(teamWriteAckSchema)

  .mutation("removeMember")
  .withInput(teamApiRemoveMemberInputSchema)
  .withOutput(teamMemberRemovedSchema)
  .build();
