// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every `scimToken.*` procedure, declared once. The names are the settings
 * page's cache keys, so they are the wire names it has always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  generateScimTokenSchema,
  issuedScimTokenSchema,
  revokeScimTokenSchema,
  scimTokenRevokedSchema,
  scimTokenScopeSchema,
  scimTokenSummarySchema,
} from "./scim-token.ts";

export const scimTokenTrpc = defineTrpcContract("scimToken")
  /** The organization's tokens, as the settings page shows them. */
  .query("list")
  .withInput(scimTokenScopeSchema)
  .withOutput(scimTokenSummarySchema.array())

  /** Mints one for a directory connection; the secret is answered once. */
  .mutation("generate")
  .withInput(generateScimTokenSchema)
  .withOutput(issuedScimTokenSchema)

  /** Retires one, so the directory it belonged to stops provisioning. */
  .mutation("revoke")
  .withInput(revokeScimTokenSchema)
  .withOutput(scimTokenRevokedSchema)
  .build();
