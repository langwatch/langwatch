export type OrganizationMfaRequirementMail = {
  to: string;
  organizationName: string;
  actorName: string;
  required: boolean;
  /** Stable identity of this member's delivery, so a retry is not a second mail. */
  idempotencyKey?: string;
};

/** The mail telling one member their organization's second-factor requirement changed. */
export abstract class OrganizationMfaRequirementMailChannel {
  abstract sendRequirementChanged(input: OrganizationMfaRequirementMail): Promise<void>;
}
