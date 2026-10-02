import { z } from "zod";

/** An organization's membership milestones, which peers react to from their own side (§9). */
export const ORGANIZATION_SIGNED_UP_EVENT_TYPE = "lw.organization.signed_up" as const;
export const MEMBERS_INVITED_EVENT_TYPE = "lw.organization.members_invited" as const;
export const INVITE_ACCEPTED_EVENT_TYPE = "lw.organization.invite_accepted" as const;
export const INTEGRATION_METHOD_CHOSEN_EVENT_TYPE =
  "lw.organization.integration_method_chosen" as const;

const optionalText = z.string().nullish();

/** The onboarding answers a new person gave, as main's signup hook read them. */
export const nurturingSignUpDataSchema = z
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
export const organizationSignedUpEventDataSchema = z.object({
  ...envelope,
  organizationName: z.string(),
  signUpData: nurturingSignUpDataSchema.nullish(),
  primaryIntent: z.string().nullish(),
});
export type OrganizationSignedUpEventData = z.infer<typeof organizationSignedUpEventDataSchema>;

/** One invitation batch: a role per invite, and the members plus pending invites counting it. */
export const membersInvitedEventDataSchema = z.object({
  ...envelope,
  inviteIds: z.array(z.string().min(1)).min(1),
  roles: z.array(z.string()).min(1),
  teamMemberCount: z.number().int().nonnegative(),
});
export type MembersInvitedEventData = z.infer<typeof membersInvitedEventDataSchema>;

/** An invitation was accepted by the person it named. */
export const inviteAcceptedEventDataSchema = z.object({
  ...envelope,
  inviteId: z.string().min(1),
  organizationName: z.string(),
});
export type InviteAcceptedEventData = z.infer<typeof inviteAcceptedEventDataSchema>;

/**
 * Somebody picked how they will integrate. The onboarding screen names only the person, so the
 * event is theirs: tenant and aggregate are the user id.
 */
export const integrationMethodChosenEventDataSchema = z.object({
  tenantId: z.string().min(1),
  userId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  selection: integrationMethodSelectionSchema,
});
export type IntegrationMethodChosenEventData = z.infer<
  typeof integrationMethodChosenEventDataSchema
>;
