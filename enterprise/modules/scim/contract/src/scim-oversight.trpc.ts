// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Every `scimOversight.*` procedure: the back office's directory-sync
 * oversight (ADR-122), gated on the staff list like `ssoConnections.*`.
 */
import { defineTrpcContract } from "@langwatch/api/contract";

import {
  directoryIdentityRowSchema,
  listOversightSyncsInputSchema,
  oversightConnectionInputSchema,
  oversightSyncListSchema,
  oversightSyncSchema,
  redriveRetiredApplyInputSchema,
  redriveRetiredApplyResultSchema,
} from "./scim-oversight.ts";

export const scimOversightTrpc = defineTrpcContract("scimOversight")
  .query("getAll")
  .withInput(listOversightSyncsInputSchema)
  .withOutput(oversightSyncListSchema)

  .query("getById")
  .withInput(oversightConnectionInputSchema)
  .withOutput(oversightSyncSchema.nullable())

  .query("directoryIdentities")
  .withInput(oversightConnectionInputSchema)
  .withOutput(directoryIdentityRowSchema.array())

  /** The one write: a retired removal sent through again, operator recorded. */
  .mutation("redriveRetiredApply")
  .withInput(redriveRetiredApplyInputSchema)
  .withOutput(redriveRetiredApplyResultSchema)
  .build();
