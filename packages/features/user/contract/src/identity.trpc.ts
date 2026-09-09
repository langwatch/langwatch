/**
 * The one `identity.*` procedure the app itself calls: spending an email
 * verification ceremony for the session user's own record.
 *
 * It is declared by the user module because the catalogue names no procedure
 * of this shape anywhere else and it acts on the caller's own account.
 * Spec: specs/identity/identifier-model.feature.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import { identityVerificationCompletedSchema } from "./user.ts";
import { userApiCompleteVerificationInputSchema } from "./user.schemas.ts";

export const identityTrpc = defineTrpcContract("identity")
  .mutation("completeVerification")
  .withInput(userApiCompleteVerificationInputSchema)
  .withOutput(identityVerificationCompletedSchema)
  .build();
