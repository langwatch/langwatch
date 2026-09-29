import {
  integrationMethodSelectionSchema,
  nurturingSignUpDataSchema,
} from "@langwatch/enterprise-nurturing-contract";
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

/** An organization's membership milestones, and the integration method its founder chose. */
export const ORGANIZATION_LIFECYCLE_PIPELINE_NAME = "organization_lifecycle" as const;
export const ORGANIZATION_AGGREGATE_TYPE = "organization" as const;
export const ORGANIZATION_LIFECYCLE_EVENT_VERSION = "2026-09-29" as const;

export const ORGANIZATION_SIGNED_UP_EVENT_TYPE = "lw.organization.signed_up" as const;
export const MEMBERS_INVITED_EVENT_TYPE = "lw.organization.members_invited" as const;
export const INVITE_ACCEPTED_EVENT_TYPE = "lw.organization.invite_accepted" as const;
export const INTEGRATION_METHOD_CHOSEN_EVENT_TYPE =
  "lw.organization.integration_method_chosen" as const;
export const RECORD_SIGNED_UP_COMMAND_TYPE = "lw.organization.record_signed_up" as const;
export const RECORD_MEMBERS_INVITED_COMMAND_TYPE =
  "lw.organization.record_members_invited" as const;
export const RECORD_INVITE_ACCEPTED_COMMAND_TYPE =
  "lw.organization.record_invite_accepted" as const;
export const RECORD_INTEGRATION_METHOD_CHOSEN_COMMAND_TYPE =
  "lw.organization.record_integration_method_chosen" as const;

const envelope = {
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
};

/** Somebody finished onboarding by creating this organization. */
export const recordSignedUpCommandDataSchema = z.object({
  ...envelope,
  organizationName: z.string(),
  signUpData: nurturingSignUpDataSchema.nullish(),
  primaryIntent: z.string().nullish(),
});
export type RecordSignedUpCommandData = z.infer<typeof recordSignedUpCommandDataSchema>;

/** One invitation batch: a role per invite, and the members plus pending invites counting it. */
export const recordMembersInvitedCommandDataSchema = z.object({
  ...envelope,
  inviteIds: z.array(z.string().min(1)).min(1),
  roles: z.array(z.string()).min(1),
  teamMemberCount: z.number().int().nonnegative(),
});
export type RecordMembersInvitedCommandData = z.infer<typeof recordMembersInvitedCommandDataSchema>;

/** An invitation was accepted by the person it named. */
export const recordInviteAcceptedCommandDataSchema = z.object({
  ...envelope,
  inviteId: z.string().min(1),
  organizationName: z.string(),
});
export type RecordInviteAcceptedCommandData = z.infer<typeof recordInviteAcceptedCommandDataSchema>;

/**
 * Somebody picked how they will integrate. The onboarding screen names only the person, so the
 * event is theirs: tenant and aggregate are the user id.
 */
export const recordIntegrationMethodChosenCommandDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  selection: integrationMethodSelectionSchema,
});
export type RecordIntegrationMethodChosenCommandData = z.infer<
  typeof recordIntegrationMethodChosenCommandDataSchema
>;

const event = <Type extends string, Data extends z.ZodTypeAny>(type: Type, data: Data) =>
  z.object({
    ...EventSchema.shape,
    type: z.literal(type),
    version: z.literal(ORGANIZATION_LIFECYCLE_EVENT_VERSION),
    data,
  });

export const organizationSignedUpEventSchema = event(
  ORGANIZATION_SIGNED_UP_EVENT_TYPE,
  recordSignedUpCommandDataSchema,
);
export const membersInvitedEventSchema = event(
  MEMBERS_INVITED_EVENT_TYPE,
  recordMembersInvitedCommandDataSchema,
);
export const inviteAcceptedEventSchema = event(
  INVITE_ACCEPTED_EVENT_TYPE,
  recordInviteAcceptedCommandDataSchema,
);
export const integrationMethodChosenEventSchema = event(
  INTEGRATION_METHOD_CHOSEN_EVENT_TYPE,
  recordIntegrationMethodChosenCommandDataSchema,
);
export type OrganizationSignedUpEvent = z.infer<typeof organizationSignedUpEventSchema>;
export type MembersInvitedEvent = z.infer<typeof membersInvitedEventSchema>;
export type InviteAcceptedEvent = z.infer<typeof inviteAcceptedEventSchema>;
export type IntegrationMethodChosenEvent = z.infer<typeof integrationMethodChosenEventSchema>;
export type OrganizationLifecycleEvent =
  | OrganizationSignedUpEvent
  | MembersInvitedEvent
  | InviteAcceptedEvent
  | IntegrationMethodChosenEvent;
