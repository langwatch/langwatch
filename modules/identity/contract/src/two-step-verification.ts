/** A person's own two-step verification, and the member list an administrator reads (D06).
 *  Spec: specs/identity/mfa-and-session-shape.feature. */
import { moduleApi } from "@langwatch/kernel/module-api";
import { z } from "zod";

import { amrSchema, secondFactorSatisfactionSchema } from "./mfa-condition.ts";

/** An organization that will not let this person turn their second factor off. */
export const requiringOrganizationSchema = z.object({
  organizationId: z.string(),
  name: z.string(),
  slug: z.string(),
});
export type RequiringOrganization = z.infer<typeof requiringOrganizationSchema>;

/** What the security screen renders itself from; all empty where the deployment offers none. */
export const twoStepAccountStandingSchema = z.object({
  offered: z.boolean(),
  enabled: z.boolean(),
  holdsPasskey: z.boolean(),
  requiringOrganizations: z.array(requiringOrganizationSchema).readonly(),
});
export type TwoStepAccountStanding = z.infer<typeof twoStepAccountStandingSchema>;

/** What one member's account carries: a passkey counts through the sign-in that used it. */
export const memberAccountFactorsSchema = z.object({
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  accountEnrollmentEnabled: z.boolean(),
  passkeyCount: z.number().int().nonnegative(),
});
export type MemberAccountFactors = z.infer<typeof memberAccountFactorsSchema>;

/** One member, and how they would meet the requirement were it on. */
export const organizationMemberFactorSchema = z.object({
  ...memberAccountFactorsSchema.shape,
  satisfaction: secondFactorSatisfactionSchema,
});
export type OrganizationMemberFactor = z.infer<typeof organizationMemberFactorSchema>;

/** Where one person stands with one organization; a stranger gets a member-with-nothing's shape. */
export const organizationMfaStandingSchema = z.object({
  organizationId: z.string(),
  /** Null for a non-member, or the procedure is a directory of every tenant's name. */
  organizationName: z.string().nullable(),
  required: z.boolean(),
  satisfaction: secondFactorSatisfactionSchema,
  holdsPasskey: z.boolean(),
});
export type OrganizationMfaStanding = z.infer<typeof organizationMfaStandingSchema>;

/** What the organization's identity provider asserts, read off the sessions it minted. */
export const organizationConnectionFactorsSchema = z.object({
  connected: z.boolean(),
  assertedFactors: z.array(amrSchema).readonly(),
  assertsSecondFactor: z.boolean(),
});
export type OrganizationConnectionFactors = z.infer<typeof organizationConnectionFactorsSchema>;

/** What the organization has set, for its administrator's screen. */
export const organizationMfaRequirementSchema = z.object({
  mfaRequired: z.boolean(),
  offered: z.boolean(),
  connection: organizationConnectionFactorsSchema,
});
export type OrganizationMfaRequirement = z.infer<typeof organizationMfaRequirementSchema>;

export const organizationMfaRequirementChangeSchema = z.object({
  previous: z.boolean(),
  next: z.boolean(),
});
export type OrganizationMfaRequirementChange = z.infer<
  typeof organizationMfaRequirementChangeSchema
>;

/** The request's headers as the process read them; this package holds no Fetch `Headers`. */
export const requestHeaderRecordSchema = z.record(
  z.string(),
  z.union([z.string(), z.array(z.string())]).optional(),
);
export type RequestHeaderRecord = z.infer<typeof requestHeaderRecordSchema>;

export const twoStepDisabledSchema = z.object({ disabled: z.literal(true) });
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
