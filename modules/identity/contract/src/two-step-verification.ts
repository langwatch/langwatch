/** A person's own two-step verification, and the member list an administrator reads (D06).
 *  Spec: specs/identity/mfa-and-session-shape.feature. */
import { moduleApi } from "@langwatch/kernel/module-api";
import { z } from "zod";

import { secondFactorSatisfactionSchema } from "./mfa-condition.ts";

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

export interface TwoStepVerificationApi {
  /** The caller's own setup, for their security screen. */
  getTwoStepAccountStanding(input: { userId: string }): Promise<TwoStepAccountStanding>;
  /** Every active member, asked as though the requirement were on. */
  findOrganizationMemberFactors(input: {
    organizationId: string;
  }): Promise<OrganizationMemberFactor[]>;
}

export const TwoStepVerificationApi = moduleApi<TwoStepVerificationApi>()("identity");
