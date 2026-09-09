/**
 * Every `modelProvider.*` procedure, declared once. The names are the
 * browser's cache keys, so they are the wire names the settings pages, the
 * onboarding flow and the model pickers have always called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  modelDefaultEffectiveSchema,
  modelDefaultInheritedValuesSchema,
  modelDefaultSnapshotSchema,
  modelProviderCodexStatusSchema,
  modelProviderCredentialVerdictSchema,
} from "./model-provider.ts";
import { modelProviderListEntrySchema } from "./model-provider-list-entry.ts";
import {
  modelDefaultConfigDeleteTrpcInputSchema,
  modelDefaultConfigSaveTrpcInputSchema,
  modelDefaultConfigSavedSchema,
  modelDefaultFeatureOverrideTrpcInputSchema,
  modelDefaultInheritedValuesTrpcInputSchema,
  modelDefaultResolvedTrpcInputSchema,
  modelDefaultRoleAssignmentTrpcInputSchema,
  modelProviderCodexApplyCodingDefaultsTrpcInputSchema,
  modelProviderCodexDefaultsAppliedSchema,
  modelProviderCodexSignInPollSchema,
  modelProviderCodexSignInPollTrpcInputSchema,
  modelProviderCodexSignInStartSchema,
  modelProviderDeleteTrpcInputSchema,
  modelProviderIsManagedSchema,
  modelProviderIsManagedTrpcInputSchema,
  modelProviderListEntryMapTrpcSchema,
  modelProviderOkAckSchema,
  modelProviderOrganizationTrpcInputSchema,
  modelProviderProjectTrpcInputSchema,
  modelProviderTestConnectionTrpcInputSchema,
  modelProviderUpdateTrpcInputSchema,
  modelProviderValidateApiKeyTrpcInputSchema,
  modelProviderValidateKeyWithCustomUrlTrpcInputSchema,
} from "./model-provider.trpc-schemas.ts";

export const modelProviderTrpc = defineTrpcContract("modelProvider")
  // Every read here answers the MASKED projection: a decrypted credential is
  // only ever handed to a server-internal caller of `getExecutionProviders`.
  .query("getAllForProject")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(modelProviderListEntryMapTrpcSchema)

  .query("getAllForProjectForFrontend")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(modelProviderListEntryMapTrpcSchema)

  /** One entry per stored row, uncollapsed — for surfaces that render every row. */
  .query("listAllForProjectForFrontend")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(z.array(modelProviderListEntrySchema))

  /** Org-wide variant: every provider anywhere in the organization, env-fed rows included. */
  .query("listAllForOrganizationForFrontend")
  .withInput(modelProviderOrganizationTrpcInputSchema)
  .withOutput(z.array(modelProviderListEntrySchema))

  .mutation("update")
  .withInput(modelProviderUpdateTrpcInputSchema)
  .withOutput(modelProviderListEntrySchema)

  .mutation("delete")
  .withInput(modelProviderDeleteTrpcInputSchema)

  /** Probes a credential the caller has just typed, before anything stores it. */
  .mutation("validateApiKey")
  .withInput(modelProviderValidateApiKeyTrpcInputSchema)
  .withOutput(modelProviderCredentialVerdictSchema)

  /** Probes a credential that is already stored. */
  .mutation("testConnection")
  .withInput(modelProviderTestConnectionTrpcInputSchema)
  .withOutput(modelProviderCredentialVerdictSchema)

  /** Codex step 1: request a device code. Nothing stored; round-trips via the client. */
  .mutation("codexSignInStart")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(modelProviderCodexSignInStartSchema)

  /** Codex step 2..n: poll approval, save the token, optionally set coding defaults. */
  .mutation("codexSignInPoll")
  .withInput(modelProviderCodexSignInPollTrpcInputSchema)
  .withOutput(modelProviderCodexSignInPollSchema)

  /** Points the coding-assistant roles at codex, after the connect dialog's "yes". */
  .mutation("codexApplyCodingDefaults")
  .withInput(modelProviderCodexApplyCodingDefaultsTrpcInputSchema)
  .withOutput(modelProviderCodexDefaultsAppliedSchema)

  /** Connected-state only: no tokens, no email — a member must not read the admin's. */
  .query("codexStatus")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(modelProviderCodexStatusSchema)

  .query("isManagedProvider")
  .withInput(modelProviderIsManagedTrpcInputSchema)
  .withOutput(modelProviderIsManagedSchema)

  /** Validates a stored or environment-fed key against a custom or default base URL. */
  .query("validateKeyWithCustomUrl")
  .withInput(modelProviderValidateKeyWithCustomUrlTrpcInputSchema)
  .withOutput(modelProviderCredentialVerdictSchema)

  // Role and feature-keyed defaults; specs/model-providers/role-based-default-models.feature
  /** Cascade-resolves a feature key; answers null, not a refusal, when unconfigured. */
  .query("getResolvedDefault")
  .withInput(modelDefaultResolvedTrpcInputSchema)
  .withOutput(modelDefaultEffectiveSchema.nullable())

  /** The snapshot behind the Default Models settings page. */
  .query("getDefaultModelsForProject")
  .withInput(modelProviderProjectTrpcInputSchema)
  .withOutput(modelDefaultSnapshotSchema)

  /** Single-key writers: update the matching key in place, or create one if absent. */
  .mutation("setRoleAssignmentForScope")
  .withInput(modelDefaultRoleAssignmentTrpcInputSchema)
  .withOutput(modelProviderOkAckSchema)

  .mutation("setFeatureOverrideForScope")
  .withInput(modelDefaultFeatureOverrideTrpcInputSchema)
  .withOutput(modelProviderOkAckSchema)

  /** Full-config writer: a whole policy including its scope attachments. */
  .mutation("saveDefaultModelsConfig")
  .withInput(modelDefaultConfigSaveTrpcInputSchema)
  .withOutput(modelDefaultConfigSavedSchema)

  /** Delete a config; its scope attachments cascade. */
  .mutation("deleteDefaultModelsConfig")
  .withInput(modelDefaultConfigDeleteTrpcInputSchema)
  .withOutput(modelProviderOkAckSchema)

  /**
   * "What would the cascade hand back for these scopes if I had no value
   * here?" — the drawer's inherited-as-placeholder and its "Inherit (from
   * organization)" dropdown entry.
   */
  .query("getInheritedValuesForScopes")
  .withInput(modelDefaultInheritedValuesTrpcInputSchema)
  .withOutput(modelDefaultInheritedValuesSchema)
  .build();
