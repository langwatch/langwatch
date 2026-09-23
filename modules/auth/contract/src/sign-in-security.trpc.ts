/**
 * Every `signInSecurity.*` procedure, declared once. The names are the
 * browser's cache keys and main's wire names.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  releaseHeldAccountInputSchema,
  releaseHeldAccountResultSchema,
  saveSignInSecurityInputSchema,
  saveSignInSecurityResultSchema,
  signInSecurityOrganizationInputSchema,
  signInSecuritySettingsSchema,
} from "./sign-in-security.ts";

export const signInSecurityTrpc = defineTrpcContract("signInSecurity")
  .query("get")
  .withInput(signInSecurityOrganizationInputSchema)
  .withOutput(signInSecuritySettingsSchema)

  .mutation("save")
  .withInput(saveSignInSecurityInputSchema)
  .withOutput(saveSignInSecurityResultSchema)

  .mutation("release")
  .withInput(releaseHeldAccountInputSchema)
  .withOutput(releaseHeldAccountResultSchema)
  .build();
