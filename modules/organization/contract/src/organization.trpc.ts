/** Organization and membership procedures; `invite.*` is its own namespace (`invite.trpc.ts`). */

import {
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
} from "@langwatch/authz-contract";
import { defineTrpcContract } from "@langwatch/module";
import { signUpDataSchema } from "@langwatch/onboarding-contract";
import { PROJECT_CREATED_EVENT_TYPE } from "@langwatch/project-contract";
import { z } from "zod";

import {
  INVITE_ACCEPTED_EVENT_TYPE,
  MEMBERS_INVITED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE,
  ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE,
  ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE,
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
} from "./organization-lifecycle.events.ts";
import {
  organizationAuditLogPageSchema,
  organizationCreatedSchema,
  organizationDirectoryCountsSchema,
  organizationMemberDirectorySchema,
  organizationInvitedMemberIdsSchema,
  organizationMemberRecordSchema,
  organizationMemberRoleChangedSchema,
  organizationUserRowsSchema,
  organizationWriteAckSchema,
} from "./organization.responses.ts";
import {
  organizationApiAuditLogsInputSchema,
  organizationApiGetAllInputSchema,
  organizationApiMemberScopeSchema,
  organizationApiScopeSchema,
  organizationApiSetMemberDisabledInputSchema,
  organizationApiUpdateInputSchema,
  organizationApiUpdateMemberRoleInputSchema,
  organizationApiUpdateTeamMemberRoleInputSchema,
  organizationApiWithMembersInputSchema,
} from "./organization.trpc-schemas.ts";
import { organizationIntentSchema } from "./organization.ts";
import { organizationApiScopeGraphInputSchema, scopeGraphSchema } from "./scope-graph.ts";

/** The first organization a person creates, and the name they gave it. */
export const organizationApiCreateAndAssignInputSchema = z.object({
  orgName: z.string().optional(),
  phoneNumber: z.string().optional(),
  signUpData: signUpDataSchema.optional(),
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

/** Every fact that changes who is in the organization, their seat or their role. */
const MEMBERSHIP_CHANGED = [
  { event: MEMBERS_INVITED_EVENT_TYPE, scope: "organizationId" },
  { event: INVITE_ACCEPTED_EVENT_TYPE, scope: "organizationId" },
  { event: ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE, scope: "organizationId" },
  { event: ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE, scope: "organizationId" },
  { event: ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE, scope: "organizationId" },
  { event: ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE, scope: "organizationId" },
  GRANT_ATTACHED_EVENT_TYPE,
  GRANT_ROLE_CHANGED_EVENT_TYPE,
  GRANT_REVOKED_EVENT_TYPE,
];

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

  /** The shell's scope skeleton, narrowed to the caller. */
  .query("getScopeGraph", {
    // Grants are appended under their organization, so they hint under their own tenant.
    invalidatedBy: [
      { event: PROJECT_CREATED_EVENT_TYPE, scope: "organizationId" },
      ORGANIZATION_SIGNED_UP_EVENT_TYPE,
      { event: INVITE_ACCEPTED_EVENT_TYPE, scope: "organizationId" },
      GRANT_ATTACHED_EVENT_TYPE,
      GRANT_ROLE_CHANGED_EVENT_TYPE,
      GRANT_REVOKED_EVENT_TYPE,
    ],
  })
  .withInput(organizationApiScopeGraphInputSchema)
  .withOutput(scopeGraphSchema)

  .mutation("update")
  .withInput(organizationApiUpdateInputSchema)
  .withOutput(organizationWriteAckSchema)

  /** The member pickers' read: names always, addresses only for an administrator. */
  .query("getOrganizationWithMembersAndTheirTeams", { invalidatedBy: MEMBERSHIP_CHANGED })
  .withInput(organizationApiWithMembersInputSchema)
  .withOutput(organizationMemberDirectorySchema)

  /** The Directory's tab badges: counts only, so a closed tab loads no list. */
  .query("getDirectoryCounts", { invalidatedBy: MEMBERSHIP_CHANGED })
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationDirectoryCountsSchema)

  .query("getMemberById", { invalidatedBy: MEMBERSHIP_CHANGED })
  .withInput(organizationApiMemberScopeSchema)
  .withOutput(organizationMemberRecordSchema)

  /** The members invitations brought; the browser joins identity's admissions to it. */
  .query("getInvitedMemberIds", { invalidatedBy: MEMBERSHIP_CHANGED })
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationInvitedMemberIdsSchema)

  .mutation("updateTeamMemberRole")
  .withInput(organizationApiUpdateTeamMemberRoleInputSchema)
  .withOutput(organizationWriteAckSchema)

  .query("getAllOrganizationMembers", { invalidatedBy: MEMBERSHIP_CHANGED })
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationUserRowsSchema)

  .mutation("updateMemberRole")
  .withInput(organizationApiUpdateMemberRoleInputSchema)
  .withOutput(organizationMemberRoleChangedSchema)

  .query("getAuditLogs")
  .withInput(organizationApiAuditLogsInputSchema)
  .withOutput(organizationAuditLogPageSchema)
  .build();
