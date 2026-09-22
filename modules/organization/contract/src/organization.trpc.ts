/** All organization, membership, and invitation procedures in one namespace. */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { onboardingWriteAckSchema, organizationInitializedSchema } from "./onboarding.responses.ts";
import {
  organizationAuditLogPageSchema,
  organizationCreatedSchema,
  organizationInviteAcceptedSchema,
  organizationInviteResentSchema,
  organizationInvitesCreatedSchema,
  organizationListedInvitesSchema,
  organizationMemberProvenanceByUserSchema,
  organizationMemberRoleChangedSchema,
  organizationUserRowsSchema,
  organizationWriteAckSchema,
} from "./organization.responses.ts";
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
 * The four keys the "pick your flavour" screen offers. The traits they map to
 * are the deployment's marketing vocabulary rather than this feature's, so
 * only the keys are named here.
 */
export const onboardingIntegrationMethodSchema = z.enum([
  "via-claude-code",
  "via-platform",
  "via-claude-desktop",
  "manually",
]);
export type OnboardingIntegrationMethod = z.infer<typeof onboardingIntegrationMethodSchema>;

/**
 * The whole sign-up ceremony in one request. `primaryIntent` stays optional
 * for rolling-deploy tolerance (ADR-038).
 */
export const onboardingInitializeOrganizationInputSchema = z.object({
  orgName: z.string().optional(),
  phoneNumber: z.string().optional(),
  signUpData: organizationApiSignUpDataSchema.optional(),
  primaryIntent: organizationIntentSchema.optional(),

  projectName: z.string().optional(),
  language: z.string().default("other"),
  framework: z.string().default("other"),
});
export type OnboardingInitializeOrganizationInput = z.infer<
  typeof onboardingInitializeOrganizationInputSchema
>;

export const onboardingSetIntegrationMethodInputSchema = z.object({
  integrationMethod: onboardingIntegrationMethodSchema,
});
export type OnboardingSetIntegrationMethodInput = z.infer<
  typeof onboardingSetIntegrationMethodInputSchema
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

  /**
   * The sign-up ceremony. It runs before the caller belongs to any
   * organization, so neither it nor the screen after it has a scope to check.
   */
  .mutation("initializeOrganization")
  .withInput(onboardingInitializeOrganizationInputSchema)
  .withOutput(organizationInitializedSchema)

  /**
   * Records the flavour the customer picked, separately from the ceremony:
   * the organization is created before that screen is shown.
   */
  .mutation("setIntegrationMethod")
  .withInput(onboardingSetIntegrationMethodInputSchema)
  .withOutput(onboardingWriteAckSchema)
  .build();
