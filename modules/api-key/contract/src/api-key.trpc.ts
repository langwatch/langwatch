/**
 * Every `apiKey.*` procedure, declared once: name, kind, input, output.
 * The server binds a permission and handler to a name here; the browser
 * reads the same names as types — the mounted namespace, never respelled.
 */

// `create` is the ONLY procedure that ever returns the plaintext token — once,
// at minting; every read hands back a five-character `lookupIdPrefix` and
// nothing more. `nameById` answers null identically for an unknown id and one
// in another organization, so it cannot enumerate. `orgProjects` / `orgTeams`
// / `orgMembers` feed the pickers the drawers render.

import { defineTrpcContract } from "@langwatch/api/contract";

import {
  apiKeyTrpcCreateInputSchema,
  apiKeyTrpcNameByIdInputSchema,
  apiKeyTrpcOrganizationScopeSchema,
  apiKeyTrpcRevokeInputSchema,
  apiKeyTrpcUpdateInputSchema,
} from "./api-key-trpc.schemas.ts";
import { apiKeyListEntrySchema, namedApiKeyBindingSchema } from "./api-key.list.ts";
import {
  apiKeyMintedSchema,
  apiKeyNameSchema,
  apiKeyProjectSchema,
  apiKeyRevokedSchema,
  apiKeyTeamSchema,
  apiKeyUpdatedSchema,
  apiKeyUserSchema,
} from "./api-key.responses.ts";

export const apiKeyTrpc = defineTrpcContract("apiKey")
  .query("myBindings")
  .withInput(apiKeyTrpcOrganizationScopeSchema)
  .withOutput(namedApiKeyBindingSchema.array())

  .query("nameById")
  .withInput(apiKeyTrpcNameByIdInputSchema)
  .withOutput(apiKeyNameSchema.nullable())

  .query("list")
  .withInput(apiKeyTrpcOrganizationScopeSchema)
  .withOutput(apiKeyListEntrySchema.array())

  .mutation("create")
  .withInput(apiKeyTrpcCreateInputSchema)
  .withOutput(apiKeyMintedSchema)

  .mutation("update")
  .withInput(apiKeyTrpcUpdateInputSchema)
  .withOutput(apiKeyUpdatedSchema)

  .mutation("revoke")
  .withInput(apiKeyTrpcRevokeInputSchema)
  .withOutput(apiKeyRevokedSchema)

  .query("orgProjects")
  .withInput(apiKeyTrpcOrganizationScopeSchema)
  .withOutput(apiKeyProjectSchema.array())

  .query("orgTeams")
  .withInput(apiKeyTrpcOrganizationScopeSchema)
  .withOutput(apiKeyTeamSchema.array())

  .query("orgMembers")
  .withInput(apiKeyTrpcOrganizationScopeSchema)
  .withOutput(apiKeyUserSchema.array())

  .build();
