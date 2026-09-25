/** The `twoStepVerification.*` procedures (D06), under main's namespace. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  organizationMemberFactorSchema,
  organizationMfaRequirementChangeSchema,
  organizationMfaRequirementSchema,
  organizationMfaStandingSchema,
  twoStepAccountStandingSchema,
  twoStepDisabledSchema,
} from "./two-step-verification.ts";

const organizationInputSchema = z.object({ organizationId: z.string().min(1) });

export const twoStepVerificationTrpc = defineTrpcContract("twoStepVerification")
  .query("account")
  .withInput(z.object({}))
  .withOutput(twoStepAccountStandingSchema)

  .mutation("disable")
  .withInput(
    z.object({
      /** Absent for an account that holds none; a current code is demanded either way. */
      password: z.string().min(1).optional(),
      code: z.string().min(1),
    }),
  )
  .withOutput(twoStepDisabledSchema)

  .query("standing")
  .withInput(organizationInputSchema)
  .withOutput(organizationMfaStandingSchema)

  .query("requirement")
  .withInput(organizationInputSchema)
  .withOutput(organizationMfaRequirementSchema)

  .mutation("setRequirement")
  .withInput(z.object({ organizationId: z.string().min(1), mfaRequired: z.boolean() }))
  .withOutput(organizationMfaRequirementChangeSchema)

  .query("memberFactors")
  .withInput(organizationInputSchema)
  .withOutput(z.array(organizationMemberFactorSchema))
  .build();
