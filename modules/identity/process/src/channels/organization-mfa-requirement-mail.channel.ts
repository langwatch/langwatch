export type OrganizationMfaRequirementMail = {
  to: string;
  organizationName: string;
  actorName: string;
  required: boolean;
};

/** The mail telling one member their organization's second-factor requirement changed. */
export abstract class OrganizationMfaRequirementMailChannel {
  abstract sendRequirementChanged(input: OrganizationMfaRequirementMail): Promise<void>;
}
