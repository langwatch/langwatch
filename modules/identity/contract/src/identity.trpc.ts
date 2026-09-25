/** The `identity.*` procedures: the session user's own identity (D01).
 *  Spec: specs/identity/identifier-model.feature. */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  accountIdentifierSchema,
  emailIdentifierAddedSchema,
  identifierCodeChallengeSchema,
  methodsLastUsedSchema,
} from "./account-identifiers.ts";
import { ssoTestArrivalStandingSchema } from "./sso-admission.ts";

const emptyInputSchema = z.object({});

/** Both proofs together: the emailed token and the PKCE verifier the starting browser kept. */
export const completeVerificationInputSchema = z.object({
  identifierId: z.string().min(1),
  verificationId: z.string().min(1),
  token: z.string().min(1),
  // RFC 7636 §4.1: 43-128 characters from the unreserved set.
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,128}$/),
});

export const identityTrpc = defineTrpcContract("identity")
  .mutation("completeVerification")
  .withInput(completeVerificationInputSchema)
  .withOutput(z.object({ verified: z.literal(true) }).strict())

  .query("myTestArrival")
  .withInput(emptyInputSchema)
  .withOutput(ssoTestArrivalStandingSchema)

  .query("myIdentifiers")
  .withInput(emptyInputSchema)
  .withOutput(z.array(accountIdentifierSchema))

  .query("myMethodsLastUsed")
  .withInput(emptyInputSchema)
  .withOutput(methodsLastUsedSchema)

  .mutation("addEmailIdentifier")
  .withInput(z.object({ email: z.email().max(254), codeChallenge: identifierCodeChallengeSchema }))
  .withOutput(emailIdentifierAddedSchema)

  .mutation("resendIdentifierConfirmation")
  .withInput(
    z.object({ identifierId: z.string().min(1), codeChallenge: identifierCodeChallengeSchema }),
  )
  .withOutput(z.object({ sent: z.literal(true) }).strict())

  .mutation("removeIdentifier")
  .withInput(z.object({ identifierId: z.string().min(1) }))
  .withOutput(z.object({ removed: z.literal(true) }).strict())
  .build();
