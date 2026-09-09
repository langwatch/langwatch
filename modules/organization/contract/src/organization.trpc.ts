/**
 * Every `organization.*` procedure, declared once. An organization, the people
 * in it and the invitations that put them there are all organization subjects,
 * so one namespace owns all three.
 *
 * Three reads answer a deeply nested cross-row aggregate that has no contract
 * schema yet - Organization joined to Team, TeamUser, CustomRole, the project
 * feature's Project row and User, several fields redacted per viewer. They
 * declare an unknown answer rather than a wrong one; deriving the real schemas
 * from `organization.rows.ts` is a follow-up of its own.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  organizationApiAcceptInviteInputSchema,
  organizationApiAuditLogsInputSchema,
  organizationApiCreateInvitesInputSchema,
  organizationApiGetAllInputSchema,
  organizationApiInviteScopeSchema,
  organizationApiMemberScopeSchema,
  organizationApiScopeSchema,
  organizationApiSetMemberDisabledInputSchema,
  organizationApiUpdateInputSchema,
  organizationApiUpdateMemberRoleInputSchema,
  organizationApiUpdateTeamMemberRoleInputSchema,
  organizationApiWithMembersInputSchema,
} from "./organization.trpc-schemas.ts";
import {
  organizationAuditLogPageSchema,
  organizationCreatedSchema,
  organizationInviteAcceptedSchema,
  organizationInviteResentSchema,
  organizationInvitesCreatedSchema,
  organizationListedInvitesSchema,
  organizationMemberRoleChangedSchema,
  organizationUserRowsSchema,
  organizationWriteAckSchema,
} from "./organization.responses.ts";
import { organizationIntentSchema } from "./organization.ts";

/**
 * The sign-up questionnaire, as the ceremony forwards it. Opaque on purpose:
 * the questions are the deployment's, and every reader of the answers is a
 * capability the process supplies.
 */
export const organizationApiSignUpDataSchema = z.record(z.string(), z.unknown());
export type OrganizationApiSignUpData = z.infer<typeof organizationApiSignUpDataSchema>;

/** The first organization a person creates, and the name they gave it. */
export const organizationApiCreateAndAssignInputSchema = z.object({
  orgName: z.string().optional(),
  phoneNumber: z.string().optional(),
  signUpData: organizationApiSignUpDataSchema.optional(),
  primaryIntent: organizationIntentSchema.optional(),
});
export type OrganizationApiCreateAndAssignInput = z.infer<
  typeof organizationApiCreateAndAssignInputSchema
>;

/**
 * The aggregate `getAll` answers with. Unknown rather than wrong: the rows nest
 * four row types across two features and no schema describes them yet, and a
 * partial one would strip fields the shell reads.
 */
export const organizationFullyLoadedListSchema = z.array(z.unknown());

/** The same reason, for the two single-aggregate reads beside it. */
export const organizationAggregateSchema = z.unknown();

export const organizationTrpc = defineTrpcContract("organization")
  /** Sign-up: the caller's first organization and its first team. */
  .mutation("createAndAssign")
  .withInput(organizationApiCreateAndAssignInputSchema)
  .withOutput(organizationCreatedSchema)

  .mutation("deleteMember")
  .withInput(organizationApiMemberScopeSchema)
  .withOutput(organizationWriteAckSchema)

  /**
   * Disables or re-enables a membership so an organization can reconcile down
   * to the seats its licence covers.
   */
  .mutation("setMemberDisabled")
  .withInput(organizationApiSetMemberDisabledInputSchema)
  .withOutput(organizationWriteAckSchema)

  /** Every organization the caller can reach, fully loaded and redacted. */
  .query("getAll")
  .withInput(organizationApiGetAllInputSchema)
  .withOutput(organizationFullyLoadedListSchema)

  .mutation("update")
  .withInput(organizationApiUpdateInputSchema)
  .withOutput(organizationWriteAckSchema)

  /** The member pickers' read: names always, addresses only for an administrator. */
  .query("getOrganizationWithMembersAndTheirTeams")
  .withInput(organizationApiWithMembersInputSchema)
  .withOutput(organizationAggregateSchema)

  .query("getMemberById")
  .withInput(organizationApiMemberScopeSchema)
  .withOutput(organizationAggregateSchema)

  .mutation("createInvites")
  .withInput(organizationApiCreateInvitesInputSchema)
  .withOutput(organizationInvitesCreatedSchema)

  .mutation("deleteInvite")
  .withInput(organizationApiInviteScopeSchema)

  .mutation("resendInvite")
  .withInput(organizationApiInviteScopeSchema)
  .withOutput(organizationInviteResentSchema)

  .query("getOrganizationPendingInvites")
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationListedInvitesSchema)

  .mutation("acceptInvite")
  .withInput(organizationApiAcceptInviteInputSchema)
  .withOutput(organizationInviteAcceptedSchema)

  .mutation("updateTeamMemberRole")
  .withInput(organizationApiUpdateTeamMemberRoleInputSchema)
  .withOutput(organizationWriteAckSchema)

  .query("getAllOrganizationMembers")
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationUserRowsSchema)

  .mutation("updateMemberRole")
  .withInput(organizationApiUpdateMemberRoleInputSchema)
  .withOutput(organizationMemberRoleChangedSchema)

  .query("getAuditLogs")
  .withInput(organizationApiAuditLogsInputSchema)
  .withOutput(organizationAuditLogPageSchema)
  .build();
