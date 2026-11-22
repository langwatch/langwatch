/** A person's own two-step verification, and the member list an administrator reads (D06).
 *  Spec: specs/identity/mfa-and-session-shape.feature. */
import { moduleApi, type Named } from "@langwatch/module";
import { z } from "zod";

import { amrSchema, secondFactorSatisfactionSchema } from "./features/mfa/mfa-condition.ts";

/** An organization that will not let this person turn their second factor off. */
const requiringOrganizationSchemaDefinition = z.object({
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
});
export interface RequiringOrganizationSchema extends Named<
  typeof requiringOrganizationSchemaDefinition
> {}
export const requiringOrganizationSchema: RequiringOrganizationSchema =
  requiringOrganizationSchemaDefinition;
export type RequiringOrganization = z.infer<typeof requiringOrganizationSchema>;

/** What the security screen renders itself from; all empty where the deployment offers none. */
const twoStepAccountStandingSchemaDefinition = z.object({
  offered: z.boolean(),
  enabled: z.boolean(),
  holdsPasskey: z.boolean(),
  requiringOrganizations: z.array(requiringOrganizationSchema).readonly(),
});
export interface TwoStepAccountStandingSchema extends Named<
  typeof twoStepAccountStandingSchemaDefinition
> {}
export const twoStepAccountStandingSchema: TwoStepAccountStandingSchema =
  twoStepAccountStandingSchemaDefinition;
export type TwoStepAccountStanding = z.infer<typeof twoStepAccountStandingSchema>;

/** What one member's account carries: a passkey counts through the sign-in that used it. */
const memberAccountFactorsSchemaDefinition = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  accountEnrollmentEnabled: z.boolean(),
  passkeyCount: z.number().int().nonnegative(),
});
export interface MemberAccountFactorsSchema extends Named<
  typeof memberAccountFactorsSchemaDefinition
> {}
export const memberAccountFactorsSchema: MemberAccountFactorsSchema =
  memberAccountFactorsSchemaDefinition;
export type MemberAccountFactors = z.infer<typeof memberAccountFactorsSchema>;

/** One member, and how they would meet the requirement were it on. */
const organizationMemberFactorSchemaDefinition = z.object({
  ...memberAccountFactorsSchema.shape,
  satisfaction: secondFactorSatisfactionSchema,
});
export interface OrganizationMemberFactorSchema extends Named<
  typeof organizationMemberFactorSchemaDefinition
> {}
export const organizationMemberFactorSchema: OrganizationMemberFactorSchema =
  organizationMemberFactorSchemaDefinition;
export type OrganizationMemberFactor = z.infer<typeof organizationMemberFactorSchema>;

/** Where one person stands with one organization; a stranger gets a member-with-nothing's shape. */
const organizationMfaStandingSchemaDefinition = z.object({
  organizationId: z.string(),
  /** Null for a non-member, or the procedure is a directory of every tenant's name. */
  organizationName: z.string().nullable(),
  required: z.boolean(),
  satisfaction: secondFactorSatisfactionSchema,
  holdsPasskey: z.boolean(),
});
export interface OrganizationMfaStandingSchema extends Named<
  typeof organizationMfaStandingSchemaDefinition
> {}
export const organizationMfaStandingSchema: OrganizationMfaStandingSchema =
  organizationMfaStandingSchemaDefinition;
export type OrganizationMfaStanding = z.infer<typeof organizationMfaStandingSchema>;

/** What the organization's identity provider asserts, read off the sessions it minted. */
const organizationConnectionFactorsSchemaDefinition = z.object({
  connected: z.boolean(),
  assertedFactors: z.array(amrSchema).readonly(),
  assertsSecondFactor: z.boolean(),
});
export interface OrganizationConnectionFactorsSchema extends Named<
  typeof organizationConnectionFactorsSchemaDefinition
> {}
export const organizationConnectionFactorsSchema: OrganizationConnectionFactorsSchema =
  organizationConnectionFactorsSchemaDefinition;
export type OrganizationConnectionFactors = z.infer<typeof organizationConnectionFactorsSchema>;

/** What the organization has set, for its administrator's screen. */
const organizationMfaRequirementSchemaDefinition = z.object({
  mfaRequired: z.boolean(),
  offered: z.boolean(),
  connection: organizationConnectionFactorsSchema,
});
export interface OrganizationMfaRequirementSchema extends Named<
  typeof organizationMfaRequirementSchemaDefinition
> {}
export const organizationMfaRequirementSchema: OrganizationMfaRequirementSchema =
  organizationMfaRequirementSchemaDefinition;
export type OrganizationMfaRequirement = z.infer<typeof organizationMfaRequirementSchema>;

const organizationMfaRequirementChangeSchemaDefinition = z.object({
  previous: z.boolean(),
  next: z.boolean(),
});
export interface OrganizationMfaRequirementChangeSchema extends Named<
  typeof organizationMfaRequirementChangeSchemaDefinition
> {}
export const organizationMfaRequirementChangeSchema: OrganizationMfaRequirementChangeSchema =
  organizationMfaRequirementChangeSchemaDefinition;
export type OrganizationMfaRequirementChange = z.infer<
  typeof organizationMfaRequirementChangeSchema
>;

/** The request's headers as the process read them; this package holds no Fetch `Headers`. */
const requestHeaderRecordSchemaDefinition = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]).optional(),
);
export interface RequestHeaderRecordSchema extends Named<
  typeof requestHeaderRecordSchemaDefinition
> {}
export const requestHeaderRecordSchema: RequestHeaderRecordSchema =
  requestHeaderRecordSchemaDefinition;
export type RequestHeaderRecord = z.infer<typeof requestHeaderRecordSchema>;

const twoStepDisabledSchemaDefinition = z.object({ disabled: z.literal(true) });
export interface TwoStepDisabledSchema extends Named<typeof twoStepDisabledSchemaDefinition> {}
export const twoStepDisabledSchema: TwoStepDisabledSchema = twoStepDisabledSchemaDefinition;
export type TwoStepDisabled = z.infer<typeof twoStepDisabledSchema>;

export interface TwoStepVerificationApi {
  /** The caller's own setup, for their security screen. */
  getTwoStepAccountStanding(input: { userId: string }): Promise<TwoStepAccountStanding>;
  /** Every active member, asked as though the requirement were on. */
  findOrganizationMemberFactors(input: {
    organizationId: string;
  }): Promise<OrganizationMemberFactor[]>;
  /** On the session they hold now; a session that recorded nothing proved nothing. */
  getOrganizationMfaStanding(input: {
    userId: string;
    organizationId: string;
    sessionId: string | null;
  }): Promise<OrganizationMfaStanding>;
  getOrganizationMfaRequirement(input: {
    organizationId: string;
  }): Promise<OrganizationMfaRequirement>;
  /** Turning it on is the paid move; turning it off never asks the plan. Ends no session. */
  setOrganizationMfaRequirement(input: {
    organizationId: string;
    mfaRequired: boolean;
    actorUserId: string;
  }): Promise<OrganizationMfaRequirementChange>;
  /** Refused while an organization requires it, before either proof is spent. */
  disableTwoStepVerification(input: {
    userId: string;
    password?: string | undefined;
    code: string;
    headers: RequestHeaderRecord;
  }): Promise<TwoStepDisabled>;
}

export const TwoStepVerificationApi = moduleApi<TwoStepVerificationApi>()("identity");
