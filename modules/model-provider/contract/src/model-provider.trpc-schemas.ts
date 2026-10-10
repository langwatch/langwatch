import type { Named } from "@langwatch/module";
/**
 * The input shapes the Model Provider tRPC surface parses. Kept apart from
 * `model-provider.ts`'s `.strict()` service inputs so a forward-compatible client
 * can send unknown keys without tightening one to match the other into a validation error.
 */
import { z } from "zod";

import { MODEL_ROLES } from "./catalog/model-feature-registry.ts";
import { customModelUpdateInputSchema } from "./custom-model.ts";
import {
  modelProviderListEntrySchema,
  type ModelProviderListEntry,
} from "./model-provider-list-entry.ts";
import {
  modelProviderScopeTypeSchema,
  modelProviderTestConnectionInputSchema,
  ROUTING_HANDLE_MAX_LENGTH,
  ROUTING_HANDLE_RULE,
} from "./model-provider.ts";
import type { ModelDefaultEffective } from "./model-provider.ts";

/**
 * The scope-assignment shape the clients send — deliberately not the
 * contract's `.strict()` `modelProviderScopeSchema`: this input has always
 * accepted unknown keys, and tightening it would break forward-compat clients.
 */
const modelProviderScopeAssignmentInputSchemaDefinition = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string().min(1),
});
export interface ModelProviderScopeAssignmentInputSchema extends Named<
  typeof modelProviderScopeAssignmentInputSchemaDefinition
> {}
export const modelProviderScopeAssignmentInputSchema: ModelProviderScopeAssignmentInputSchema =
  modelProviderScopeAssignmentInputSchemaDefinition;

/**
 * Shared input shape for provider write paths: name the tenant with either
 * handle, refusing neither. A create with no project must also say where
 * the credential lands, since there's no project to default the scope from.
 */
export const modelProviderTenantAnchorFields = {
  projectId: z.string().optional(),
  organizationId: z.string().optional(),
};

export function modelProviderTenantAnchor(
  input: { projectId?: string; organizationId?: string },
  ctx: z.RefinementCtx,
): void {
  if (!input.projectId && !input.organizationId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Either projectId or organizationId is required.",
      path: ["projectId"],
    });
  }
}

/** One project, named by the surface that is reading it. */
const modelProviderProjectTrpcInputSchemaDefinition = z.object({ projectId: z.string() });
export interface ModelProviderProjectTrpcInputSchema extends Named<
  typeof modelProviderProjectTrpcInputSchemaDefinition
> {}
export const modelProviderProjectTrpcInputSchema: ModelProviderProjectTrpcInputSchema =
  modelProviderProjectTrpcInputSchemaDefinition;

/** One organization, named by the surface that is reading it. */
const modelProviderOrganizationTrpcInputSchemaDefinition = z.object({
  organizationId: z.string(),
});
export interface ModelProviderOrganizationTrpcInputSchema extends Named<
  typeof modelProviderOrganizationTrpcInputSchemaDefinition
> {}
export const modelProviderOrganizationTrpcInputSchema: ModelProviderOrganizationTrpcInputSchema =
  modelProviderOrganizationTrpcInputSchemaDefinition;

const modelProviderUpdateTrpcInputSchemaDefinition = z
  .object({
    id: z.string().optional(),
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
    // Human-readable label for the settings list and model-selector group
    // headers. Defaults to the humanized provider name ("openai" → "OpenAI")
    // when omitted; lets operators distinguish same-provider instances.
    name: z.string().trim().min(1).max(128).optional(),
    enabled: z.boolean(),
    customKeys: z.object({}).passthrough().optional().nullable(),
    customModels: customModelUpdateInputSchema.optional().nullable(),
    customEmbeddingsModels: customModelUpdateInputSchema.optional().nullable(),
    extraHeaders: z
      .array(z.object({ key: z.string(), value: z.string() }))
      .optional()
      .nullable(),
    defaultModel: z.string().optional(),
    // The slug addressing THIS instance in a gateway model string
    // ("eu/claude-sonnet-5"). Omitted leaves the stored handle alone; an
    // empty string clears it. Length and message match the service's own
    // validation module, so the two can't drift; reserved names are
    // checked there too.
    routingHandle: z
      .string()
      .max(ROUTING_HANDLE_MAX_LENGTH, ROUTING_HANDLE_RULE)
      .optional()
      .nullable(),
    // Multi-scope writes (iter 109). `scopes` is the canonical shape;
    // `scopeType`/`scopeId` remain for the transition period so older
    // callers still compile. When both arrive, `scopes` wins. The
    // service runs the fail-closed authz check on every entry before
    // persisting — any non-manageable scope aborts the whole write.
    scopes: z
      .array(modelProviderScopeAssignmentInputSchema)
      .min(1, "At least one scope must be selected.")
      .optional(),
    scopeType: modelProviderScopeTypeSchema.optional(),
    scopeId: z.string().optional(),
    // Advanced (Gateway) fields live on the same ModelProvider row.
    // Accepted on the unified write path so the drawer ships one Save
    // button across basic + advanced settings.
    rateLimitRpm: z.number().int().min(0).nullable().optional(),
    rateLimitTpm: z.number().int().min(0).nullable().optional(),
    rateLimitRpd: z.number().int().min(0).nullable().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    providerConfig: z.object({}).passthrough().nullable().optional(),
    // Regular expression sources naming the models allowed to run a Langy
    // conversation with the permission checks skipped (ADR-129). Whether each
    // line compiles is checked in the service, which owns the refusal the
    // drawer renders on the field. Omitted leaves the stored list alone; an
    // empty list clears it and returns the provider to its registry default.
    langySkipPermissionsModels: z
      .array(z.string().trim().min(1).max(200))
      .max(50)
      .nullable()
      .optional(),
  })
  .superRefine(modelProviderTenantAnchor);
export interface ModelProviderUpdateTrpcInputSchema extends Named<
  typeof modelProviderUpdateTrpcInputSchemaDefinition
> {}
export const modelProviderUpdateTrpcInputSchema: ModelProviderUpdateTrpcInputSchema =
  modelProviderUpdateTrpcInputSchemaDefinition;

const modelProviderDeleteTrpcInputSchemaDefinition = z
  .object({
    id: z.string().optional(),
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
  })
  .superRefine(modelProviderTenantAnchor);
export interface ModelProviderDeleteTrpcInputSchema extends Named<
  typeof modelProviderDeleteTrpcInputSchemaDefinition
> {}
export const modelProviderDeleteTrpcInputSchema: ModelProviderDeleteTrpcInputSchema =
  modelProviderDeleteTrpcInputSchemaDefinition;

const modelProviderValidateApiKeyTrpcInputSchemaDefinition = z
  .object({
    ...modelProviderTenantAnchorFields,
    provider: z.string(),
    customKeys: z.record(z.string(), z.string()),
    // The scopes the credential is being set up for. Required on the
    // no-project path, where they are what the probe is authorized
    // against — see the process's credential-probe policy.
    scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1).optional(),
  })
  .superRefine(modelProviderTenantAnchor);
export interface ModelProviderValidateApiKeyTrpcInputSchema extends Named<
  typeof modelProviderValidateApiKeyTrpcInputSchemaDefinition
> {}
export const modelProviderValidateApiKeyTrpcInputSchema: ModelProviderValidateApiKeyTrpcInputSchema =
  modelProviderValidateApiKeyTrpcInputSchemaDefinition;

/**
 * The stored-credential probe. The service input already refuses a request
 * naming neither tenant; the transport adds the same rule again so the
 * rejection arrives on the `projectId` field the form is watching.
 */
const modelProviderTestConnectionTrpcInputSchemaDefinition =
  modelProviderTestConnectionInputSchema.superRefine(modelProviderTenantAnchor);
export interface ModelProviderTestConnectionTrpcInputSchema extends Named<
  typeof modelProviderTestConnectionTrpcInputSchemaDefinition
> {}
export const modelProviderTestConnectionTrpcInputSchema: ModelProviderTestConnectionTrpcInputSchema =
  modelProviderTestConnectionTrpcInputSchemaDefinition;

const modelProviderCodexSignInPollTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  deviceAuthId: z.string(),
  userCode: z.string(),
  scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1),
  /** Langy setup + onboarding pass true: also point the allowed
   *  feature slots at the codex model. Settings passes false. */
  setAsCodingDefaults: z.boolean().default(false),
});
export interface ModelProviderCodexSignInPollTrpcInputSchema extends Named<
  typeof modelProviderCodexSignInPollTrpcInputSchemaDefinition
> {}
export const modelProviderCodexSignInPollTrpcInputSchema: ModelProviderCodexSignInPollTrpcInputSchema =
  modelProviderCodexSignInPollTrpcInputSchemaDefinition;

const modelProviderCodexApplyCodingDefaultsTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  scopes: z.array(modelProviderScopeAssignmentInputSchema).min(1),
});
export interface ModelProviderCodexApplyCodingDefaultsTrpcInputSchema extends Named<
  typeof modelProviderCodexApplyCodingDefaultsTrpcInputSchemaDefinition
> {}
export const modelProviderCodexApplyCodingDefaultsTrpcInputSchema: ModelProviderCodexApplyCodingDefaultsTrpcInputSchema =
  modelProviderCodexApplyCodingDefaultsTrpcInputSchemaDefinition;

const modelProviderIsManagedTrpcInputSchemaDefinition = z.object({
  organizationId: z.string(),
  provider: z.string(),
});
export interface ModelProviderIsManagedTrpcInputSchema extends Named<
  typeof modelProviderIsManagedTrpcInputSchemaDefinition
> {}
export const modelProviderIsManagedTrpcInputSchema: ModelProviderIsManagedTrpcInputSchema =
  modelProviderIsManagedTrpcInputSchemaDefinition;

const modelProviderValidateKeyWithCustomUrlTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  provider: z.string(),
  customBaseUrl: z.string().optional(),
});
export interface ModelProviderValidateKeyWithCustomUrlTrpcInputSchema extends Named<
  typeof modelProviderValidateKeyWithCustomUrlTrpcInputSchemaDefinition
> {}
export const modelProviderValidateKeyWithCustomUrlTrpcInputSchema: ModelProviderValidateKeyWithCustomUrlTrpcInputSchema =
  modelProviderValidateKeyWithCustomUrlTrpcInputSchemaDefinition;

/** The scopes a default-model config attaches to, as the drawer sends them. */
const modelDefaultScopedConfigInputSchemaDefinition = z
  .array(
    z.object({
      scopeType: modelProviderScopeTypeSchema,
      scopeId: z.string().min(1),
    }),
  )
  .min(1, "Pick at least one scope.");
export interface ModelDefaultScopedConfigInputSchema extends Named<
  typeof modelDefaultScopedConfigInputSchemaDefinition
> {}
export const modelDefaultScopedConfigInputSchema: ModelDefaultScopedConfigInputSchema =
  modelDefaultScopedConfigInputSchemaDefinition;

const modelDefaultResolvedTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  featureKey: z.string(),
});
export interface ModelDefaultResolvedTrpcInputSchema extends Named<
  typeof modelDefaultResolvedTrpcInputSchemaDefinition
> {}
export const modelDefaultResolvedTrpcInputSchema: ModelDefaultResolvedTrpcInputSchema =
  modelDefaultResolvedTrpcInputSchemaDefinition;

const modelDefaultRoleAssignmentTrpcInputSchemaDefinition = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string(),
  role: z.enum(MODEL_ROLES),
  model: z.string().nullable(),
});
export interface ModelDefaultRoleAssignmentTrpcInputSchema extends Named<
  typeof modelDefaultRoleAssignmentTrpcInputSchemaDefinition
> {}
export const modelDefaultRoleAssignmentTrpcInputSchema: ModelDefaultRoleAssignmentTrpcInputSchema =
  modelDefaultRoleAssignmentTrpcInputSchemaDefinition;

const modelDefaultFeatureOverrideTrpcInputSchemaDefinition = z.object({
  scopeType: modelProviderScopeTypeSchema,
  scopeId: z.string(),
  featureKey: z.string(),
  model: z.string().nullable(),
});
export interface ModelDefaultFeatureOverrideTrpcInputSchema extends Named<
  typeof modelDefaultFeatureOverrideTrpcInputSchemaDefinition
> {}
export const modelDefaultFeatureOverrideTrpcInputSchema: ModelDefaultFeatureOverrideTrpcInputSchema =
  modelDefaultFeatureOverrideTrpcInputSchemaDefinition;

const modelDefaultConfigSaveTrpcInputSchemaDefinition = z.object({
  id: z.string().optional(),
  config: z.record(z.string(), z.string()),
  scopes: modelDefaultScopedConfigInputSchema,
});
export interface ModelDefaultConfigSaveTrpcInputSchema extends Named<
  typeof modelDefaultConfigSaveTrpcInputSchemaDefinition
> {}
export const modelDefaultConfigSaveTrpcInputSchema: ModelDefaultConfigSaveTrpcInputSchema =
  modelDefaultConfigSaveTrpcInputSchemaDefinition;

const modelDefaultConfigDeleteTrpcInputSchemaDefinition = z.object({ id: z.string() });
export interface ModelDefaultConfigDeleteTrpcInputSchema extends Named<
  typeof modelDefaultConfigDeleteTrpcInputSchemaDefinition
> {}
export const modelDefaultConfigDeleteTrpcInputSchema: ModelDefaultConfigDeleteTrpcInputSchema =
  modelDefaultConfigDeleteTrpcInputSchemaDefinition;

const modelDefaultInheritedValuesTrpcInputSchemaDefinition = z.object({
  projectId: z.string(),
  scopes: modelDefaultScopedConfigInputSchema,
  excludeConfigId: z.string().optional(),
});
export interface ModelDefaultInheritedValuesTrpcInputSchema extends Named<
  typeof modelDefaultInheritedValuesTrpcInputSchemaDefinition
> {}
export const modelDefaultInheritedValuesTrpcInputSchema: ModelDefaultInheritedValuesTrpcInputSchema =
  modelDefaultInheritedValuesTrpcInputSchemaDefinition;

/**
 * What the two reads the studio and the dock borrow answer, both this contract's own
 * zod-inferred shapes. `getResolvedDefault` answers `null` when nothing resolves and the
 * caller falls back to its own choice rather than refusing.
 */
export type ModelProviderListAllForProjectTrpcOutput = ModelProviderListEntry[];
export type ModelDefaultResolvedTrpcOutput = ModelDefaultEffective | null;

/**
 * The list projection, keyed by provider, that the three provider reads
 * answer with. Every row is the same {@link ModelProviderListEntry} the
 * uncollapsed listings return, so a surface reading either shape reads one.
 */
const modelProviderListEntryMapTrpcSchemaDefinition = z.record(
  z.string(),
  modelProviderListEntrySchema,
);
export interface ModelProviderListEntryMapTrpcSchema extends Named<
  typeof modelProviderListEntryMapTrpcSchemaDefinition
> {}
export const modelProviderListEntryMapTrpcSchema: ModelProviderListEntryMapTrpcSchema =
  modelProviderListEntryMapTrpcSchemaDefinition;

/** Codex step 1: the device code the browser shows, and how often to poll. */
const modelProviderCodexSignInStartSchemaDefinition = z
  .object({
    userCode: z.string(),
    deviceAuthId: z.string(),
    verificationUrl: z.string(),
    intervalSeconds: z.number(),
  })
  .strict();
export interface ModelProviderCodexSignInStartSchema extends Named<
  typeof modelProviderCodexSignInStartSchemaDefinition
> {}
export const modelProviderCodexSignInStartSchema: ModelProviderCodexSignInStartSchema =
  modelProviderCodexSignInStartSchemaDefinition;

/**
 * Codex step 2..n. The complete answer hands the connector their own account
 * email, which is why the poll is a mutation rather than a query.
 */
const modelProviderCodexSignInPollSchemaDefinition = z.union([
  z.object({ status: z.literal("pending") }).strict(),
  z
    .object({
      status: z.literal("complete"),
      providerId: z.string().optional(),
      email: z.string(),
      plan: z.string(),
    })
    .strict(),
]);
export interface ModelProviderCodexSignInPollSchema extends Named<
  typeof modelProviderCodexSignInPollSchemaDefinition
> {}
export const modelProviderCodexSignInPollSchema: ModelProviderCodexSignInPollSchema =
  modelProviderCodexSignInPollSchemaDefinition;

/** What a write that answers nothing but "it happened" returns. */
const modelProviderOkAckSchemaDefinition = z.object({ ok: z.literal(true) }).strict();
export interface ModelProviderOkAckSchema extends Named<
  typeof modelProviderOkAckSchemaDefinition
> {}
export const modelProviderOkAckSchema: ModelProviderOkAckSchema =
  modelProviderOkAckSchemaDefinition;

/** The acknowledgement the Codex coding-defaults write answers with. */
const modelProviderCodexDefaultsAppliedSchemaDefinition = z
  .object({ applied: z.literal(true) })
  .strict();
export interface ModelProviderCodexDefaultsAppliedSchema extends Named<
  typeof modelProviderCodexDefaultsAppliedSchemaDefinition
> {}
export const modelProviderCodexDefaultsAppliedSchema: ModelProviderCodexDefaultsAppliedSchema =
  modelProviderCodexDefaultsAppliedSchemaDefinition;

/** Whether LangWatch itself supplies this provider's credentials. */
const modelProviderIsManagedSchemaDefinition = z.object({ managed: z.boolean() }).strict();
export interface ModelProviderIsManagedSchema extends Named<
  typeof modelProviderIsManagedSchemaDefinition
> {}
export const modelProviderIsManagedSchema: ModelProviderIsManagedSchema =
  modelProviderIsManagedSchemaDefinition;

/** The id of the default-models config a save created or replaced. */
const modelDefaultConfigSavedSchemaDefinition = z.object({ id: z.string() }).strict();
export interface ModelDefaultConfigSavedSchema extends Named<
  typeof modelDefaultConfigSavedSchemaDefinition
> {}
export const modelDefaultConfigSavedSchema: ModelDefaultConfigSavedSchema =
  modelDefaultConfigSavedSchemaDefinition;

/** One sign-in poll, and the provider it saves on approval: `completeCodexDeviceSignIn`. */
export type ModelProviderCodexSignInCompletionInput = z.infer<
  typeof modelProviderCodexSignInPollTrpcInputSchema
>;
export type ModelProviderCodexSignInCompletion = z.infer<typeof modelProviderCodexSignInPollSchema>;
