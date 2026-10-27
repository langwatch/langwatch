import type { Named } from "@langwatch/module";
import { z } from "zod";

/** An organization's membership milestones, which peers react to from their own side (§9). */
export const ORGANIZATION_SIGNED_UP_EVENT_TYPE = "lw.organization.signed_up" as const;
export const ORGANIZATION_CREATED_EVENT_TYPE = "lw.organization.created" as const;
export const ORGANIZATION_CREATED_EVENT_VERSION = "2026-10-09" as const;
export const MEMBERS_INVITED_EVENT_TYPE = "lw.organization.members_invited" as const;
export const INVITE_ACCEPTED_EVENT_TYPE = "lw.organization.invite_accepted" as const;
export const INTEGRATION_METHOD_CHOSEN_EVENT_TYPE =
  "lw.organization.integration_method_chosen" as const;

const optionalText = z.string().nullish();

/** The onboarding answers a new person gave, as main's signup hook read them. */
const nurturingSignUpDataSchemaDefinition = z
  .object({
    yourRole: optionalText,
    companySize: optionalText,
    usage: optionalText,
    solution: optionalText,
    featureUsage: optionalText,
    howDidYouHearAboutUs: optionalText,
    leadSource: optionalText,
    referrer: optionalText,
    utmCampaign: optionalText,
    utmSource: optionalText,
    utmMedium: optionalText,
    utmTerm: optionalText,
    utmContent: optionalText,
  })
  .passthrough();
export interface NurturingSignUpDataSchema extends Named<
  typeof nurturingSignUpDataSchemaDefinition
> {}
export const nurturingSignUpDataSchema: NurturingSignUpDataSchema =
  nurturingSignUpDataSchemaDefinition;

/** The product selection main's onboarding router mapped to an integration method. */
export const integrationMethodSelectionSchema = z.enum([
  "via-claude-code",
  "via-platform",
  "via-claude-desktop",
  "manually",
]);

const envelope = {
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
};

/** Somebody finished onboarding by creating this organization. */
const organizationSignedUpEventDataSchemaDefinition = z.object({
  ...envelope,
  organizationName: z.string(),
  signUpData: nurturingSignUpDataSchema.nullish(),
  primaryIntent: z.string().nullish(),
});
export interface OrganizationSignedUpEventDataSchema extends Named<
  typeof organizationSignedUpEventDataSchemaDefinition
> {}
export const organizationSignedUpEventDataSchema: OrganizationSignedUpEventDataSchema =
  organizationSignedUpEventDataSchemaDefinition;
export type OrganizationSignedUpEventData = z.infer<typeof organizationSignedUpEventDataSchema>;

/** One invitation batch: a role per invite, and the members plus pending invites counting it. */
const membersInvitedEventDataSchemaDefinition = z.object({
  ...envelope,
  inviteIds: z.array(z.string().min(1)).min(1),
  roles: z.array(z.string()).min(1),
  teamMemberCount: z.number().int().nonnegative(),
  /** Invitees who already hold an account; identity closes their open join requests from this. */
  invitees: z
    .array(z.object({ inviteId: z.string().min(1), userId: z.string().min(1) }))
    .optional(),
});
export interface MembersInvitedEventDataSchema extends Named<
  typeof membersInvitedEventDataSchemaDefinition
> {}
export const membersInvitedEventDataSchema: MembersInvitedEventDataSchema =
  membersInvitedEventDataSchemaDefinition;
export type MembersInvitedEventData = z.infer<typeof membersInvitedEventDataSchema>;

/** An invitation was accepted by the person it named. */
const inviteAcceptedEventDataSchemaDefinition = z.object({
  ...envelope,
  inviteId: z.string().min(1),
  organizationName: z.string(),
});
export interface InviteAcceptedEventDataSchema extends Named<
  typeof inviteAcceptedEventDataSchemaDefinition
> {}
export const inviteAcceptedEventDataSchema: InviteAcceptedEventDataSchema =
  inviteAcceptedEventDataSchemaDefinition;
export type InviteAcceptedEventData = z.infer<typeof inviteAcceptedEventDataSchema>;

/**
 * Somebody picked how they will integrate. The onboarding screen names only the person, so the
 * event is theirs: tenant and aggregate are the user id.
 */
const integrationMethodChosenEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  selection: integrationMethodSelectionSchema,
});
export interface IntegrationMethodChosenEventDataSchema extends Named<
  typeof integrationMethodChosenEventDataSchemaDefinition
> {}
export const integrationMethodChosenEventDataSchema: IntegrationMethodChosenEventDataSchema =
  integrationMethodChosenEventDataSchemaDefinition;
export type IntegrationMethodChosenEventData = z.infer<
  typeof integrationMethodChosenEventDataSchema
>;

export const ORGANIZATION_MEMBER_DISABLED_EVENT_TYPE = "lw.organization.member_disabled" as const;
export const ORGANIZATION_MEMBER_DISABLED_EVENT_VERSION = "2026-10-08" as const;

/** A seat was taken away; user ends the person's browser sessions on its side (§9, R7). */
const organizationMemberDisabledEventDataSchemaDefinition = z.object({
  ...envelope,
  /** Who disabled the seat; absent for an organization key with no member. */
  disabledByUserId: z.string().min(1).nullish(),
});
export interface OrganizationMemberDisabledEventDataSchema extends Named<
  typeof organizationMemberDisabledEventDataSchemaDefinition
> {}
export const organizationMemberDisabledEventDataSchema: OrganizationMemberDisabledEventDataSchema =
  organizationMemberDisabledEventDataSchemaDefinition;
export type OrganizationMemberDisabledEventData = z.infer<
  typeof organizationMemberDisabledEventDataSchema
>;

export const ORGANIZATION_MEMBER_ENABLED_EVENT_TYPE = "lw.organization.member_enabled" as const;
export const ORGANIZATION_MEMBER_ENABLED_EVENT_VERSION = "2026-10-09" as const;

/** A disabled seat given back; peers restore what the seat gave (§9, M8487-MEMBER-ENABLED). */
const organizationMemberEnabledEventDataSchemaDefinition = z.object({
  ...envelope,
  /** Who re-enabled the seat; absent for an organization key with no member. */
  enabledByUserId: z.string().min(1).nullish(),
});
export interface OrganizationMemberEnabledEventDataSchema extends Named<
  typeof organizationMemberEnabledEventDataSchemaDefinition
> {}
export const organizationMemberEnabledEventDataSchema: OrganizationMemberEnabledEventDataSchema =
  organizationMemberEnabledEventDataSchemaDefinition;
export type OrganizationMemberEnabledEventData = z.infer<
  typeof organizationMemberEnabledEventDataSchema
>;

export const ORGANIZATION_MEMBER_REMOVED_EVENT_TYPE = "lw.organization.member_removed" as const;
export const ORGANIZATION_MEMBER_REMOVED_EVENT_VERSION = "2026-10-09" as const;

/** A member left the organization; peers drop what the membership gave them (§9). */
const organizationMemberRemovedEventDataSchemaDefinition = z.object({
  ...envelope,
  /** Who removed the member; absent for a removal no member made. */
  removedByUserId: z.string().min(1).nullish(),
});
export interface OrganizationMemberRemovedEventDataSchema extends Named<
  typeof organizationMemberRemovedEventDataSchemaDefinition
> {}
export const organizationMemberRemovedEventDataSchema: OrganizationMemberRemovedEventDataSchema =
  organizationMemberRemovedEventDataSchemaDefinition;
export type OrganizationMemberRemovedEventData = z.infer<
  typeof organizationMemberRemovedEventDataSchema
>;

export const ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_TYPE =
  "lw.organization.member_department_changed" as const;
export const ORGANIZATION_MEMBER_DEPARTMENT_CHANGED_EVENT_VERSION = "2026-10-09" as const;

/** A member's department was set or cleared; peers re-read what follows the department (§9). */
const organizationMemberDepartmentChangedEventDataSchemaDefinition = z.object({
  ...envelope,
  departmentId: z.string().min(1).nullable(),
});
export interface OrganizationMemberDepartmentChangedEventDataSchema extends Named<
  typeof organizationMemberDepartmentChangedEventDataSchemaDefinition
> {}
export const organizationMemberDepartmentChangedEventDataSchema: OrganizationMemberDepartmentChangedEventDataSchema =
  organizationMemberDepartmentChangedEventDataSchemaDefinition;
export type OrganizationMemberDepartmentChangedEventData = z.infer<
  typeof organizationMemberDepartmentChangedEventDataSchema
>;

/** An organization now exists, on every creation path; peers seed their own defaults (§9). */
const organizationCreatedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  organizationName: z.string(),
  occurredAt: z.number().int().nonnegative(),
});
export interface OrganizationCreatedEventDataSchema extends Named<
  typeof organizationCreatedEventDataSchemaDefinition
> {}
export const organizationCreatedEventDataSchema: OrganizationCreatedEventDataSchema =
  organizationCreatedEventDataSchemaDefinition;
export type OrganizationCreatedEventData = z.infer<typeof organizationCreatedEventDataSchema>;
