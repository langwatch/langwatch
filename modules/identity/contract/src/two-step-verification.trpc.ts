/** The `twoStepVerification.*` procedures (D06), under main's namespace. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  organizationMemberFactorSchema,
  twoStepAccountStandingSchema,
} from "./two-step-verification.ts";

export const twoStepVerificationTrpc = defineTrpcContract("twoStepVerification")
  .query("account")
  .withInput(z.object({}))
  .withOutput(twoStepAccountStandingSchema)

  .query("memberFactors")
  .withInput(z.object({ organizationId: z.string().min(1) }))
  .withOutput(z.array(organizationMemberFactorSchema))
  .build();
