/** Organization and membership procedures; `invite.*` is its own namespace (`invite.trpc.ts`). */

import { defineTrpcContract } from "@langwatch/api/contract";
import { signUpDataSchema } from "@langwatch/onboarding-contract";
import { z } from "zod";

import {
  organizationAuditLogPageSchema,
  organizationCreatedSchema,
  organizationMemberProvenanceByUserSchema,
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

  /** Why each member is here; a second query so a failure degrades only the chips. */
  .query("getMemberProvenance")
  .withInput(organizationApiScopeSchema)
  .withOutput(organizationMemberProvenanceByUserSchema)

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
