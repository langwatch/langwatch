import { serializedHandledErrorSchema } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

export const MODEL_PROVIDER_FEATURE_ID = "model-provider" as const;
export const DEFAULT_AZURE_API_VERSION = "2025-04-01-preview";
export const ROUTING_HANDLE_MAX_LENGTH = 32;
export const ROUTING_HANDLE_RULE = `A routing handle starts with a letter or a number, then uses only letters, numbers, hyphens and underscores, up to ${ROUTING_HANDLE_MAX_LENGTH} characters.`;
export const MODEL_PROVIDER_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export const modelProviderScopeTypeSchema = z.enum(MODEL_PROVIDER_SCOPE_TYPES);
export type ModelProviderScopeType = z.infer<typeof modelProviderScopeTypeSchema>;

const modelProviderScopeSchemaDefinition = z
  .object({
    scopeType: modelProviderScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export interface ModelProviderScopeSchema extends Named<
  typeof modelProviderScopeSchemaDefinition
> {}
export const modelProviderScopeSchema: ModelProviderScopeSchema =
  modelProviderScopeSchemaDefinition;
export type ModelProviderScope = z.infer<typeof modelProviderScopeSchema>;

const modelSchemaDefinition = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["chat", "embedding", "other"]),
    maxTokens: z.number().positive().nullable().optional(),
    supportedParameters: z.array(z.string()).optional(),
    multimodalInputs: z.array(z.enum(["image", "file", "audio"])).optional(),
  })
  .strict();
export interface ModelSchema extends Named<typeof modelSchemaDefinition> {}
export const modelSchema: ModelSchema = modelSchemaDefinition;
export type Model = z.infer<typeof modelSchema>;

const providerCredentialSchemaDefinition = z.record(z.string(), z.unknown());
export interface ProviderCredentialSchema extends Named<
  typeof providerCredentialSchemaDefinition
> {}
export const providerCredentialSchema: ProviderCredentialSchema =
  providerCredentialSchemaDefinition;
const modelProviderSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    provider: z.string().min(1),
    name: z.string().min(1),
    enabled: z.boolean(),
    defaultModel: z.string().optional(),
    routingHandle: z.string().min(1).nullable(),
    scopes: z.array(modelProviderScopeSchema),
    customKeys: providerCredentialSchema.nullable(),
    customModels: z.array(modelSchema),
    customEmbeddingsModels: z.array(modelSchema),
    extraHeaders: z.array(z.object({ key: z.string(), value: z.string() }).strict()),
    rateLimitRpm: z.number().int().nonnegative().nullable(),
    rateLimitTpm: z.number().int().nonnegative().nullable(),
    rateLimitRpd: z.number().int().nonnegative().nullable(),
    fallbackPriorityGlobal: z.number().int().nullable(),
    rotationPolicy: z.literal("MANUAL").optional(),
    providerConfig: z.record(z.string(), z.unknown()).nullable(),
    /**
     * The operator's own list of models allowed to skip Langy's permission checks, as regular
     * expression sources. Null means the provider's registry default applies (ADR-129).
     */
    langySkipPermissionsModels: z.array(z.string()).nullable().optional(),
    deploymentMapping: z.record(z.string(), z.string()).nullable().optional(),
    healthStatus: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "CIRCUIT_OPEN"]).optional(),
    circuitOpenedAt: z.date().nullable().optional(),
    lastHealthCheckAt: z.date().nullable().optional(),
    disabledAt: z.date().nullable().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface ModelProviderSchema extends Named<typeof modelProviderSchemaDefinition> {}
export const modelProviderSchema: ModelProviderSchema = modelProviderSchemaDefinition;
export type ModelProvider = z.infer<typeof modelProviderSchema>;

const modelProviderSummarySchemaDefinition = modelProviderSchema
  .safeExtend({
    models: z.array(z.string()).nullable().optional(),
    embeddingsModels: z.array(z.string()).nullable().optional(),
    deploymentMapping: z.record(z.string(), z.string()).nullable().optional(),
    disabledByDefault: z.boolean().optional(),
    customKeys: providerCredentialSchema.nullable(),
    isSystem: z.boolean().default(false),
    embeddingsUnsupported: z.boolean().default(false),
  })
  .strict();
export interface ModelProviderSummarySchema extends Named<
  typeof modelProviderSummarySchemaDefinition
> {}
export const modelProviderSummarySchema: ModelProviderSummarySchema =
  modelProviderSummarySchemaDefinition;
export type ModelProviderSummary = z.infer<typeof modelProviderSummarySchema>;

/** Server-only provider value used to build model execution parameters. */
const modelProviderExecutionSchemaDefinition = modelProviderSchema
  .safeExtend({
    models: z.array(z.string()).nullable(),
    embeddingsModels: z.array(z.string()).nullable(),
    disabledByDefault: z.boolean().optional(),
    isSystem: z.boolean(),
    embeddingsUnsupported: z.boolean(),
  })
  .strict();
export interface ModelProviderExecutionSchema extends Named<
  typeof modelProviderExecutionSchemaDefinition
> {}
export const modelProviderExecutionSchema: ModelProviderExecutionSchema =
  modelProviderExecutionSchemaDefinition;
export type ModelProviderExecution = z.infer<typeof modelProviderExecutionSchema>;

/** Input for the server-side LiteLLM/NLP execution parameter preparation. */
const modelProviderExecutionPrepareInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();
export interface ModelProviderExecutionPrepareInputSchema extends Named<
  typeof modelProviderExecutionPrepareInputSchemaDefinition
> {}
export const modelProviderExecutionPrepareInputSchema: ModelProviderExecutionPrepareInputSchema =
  modelProviderExecutionPrepareInputSchemaDefinition;
export type ModelProviderExecutionPrepareInput = z.infer<
  typeof modelProviderExecutionPrepareInputSchema
>;

/** Portable key/value parameters consumed by LiteLLM-compatible runners. */
const modelProviderExecutionParametersSchemaDefinition = z.record(z.string(), z.string());
export interface ModelProviderExecutionParametersSchema extends Named<
  typeof modelProviderExecutionParametersSchemaDefinition
> {}
export const modelProviderExecutionParametersSchema: ModelProviderExecutionParametersSchema =
  modelProviderExecutionParametersSchemaDefinition;
export type ModelProviderExecutionParameters = z.infer<
  typeof modelProviderExecutionParametersSchema
>;

/** A feature-owned structured prompt executed through the deployment's model proxy. */
export type ModelProviderStructuredGenerationInput = Readonly<{
  projectId: string;
  featureKey: string;
  system: string;
  prompt: string;
  schema: z.ZodType;
  timeoutMs: number;
  maxRetries: number;
}>;

/** One message of a feature-owned text completion. */
export type ModelProviderTextMessage = Readonly<{ role: "user" | "assistant"; content: string }>;

/** A feature-owned plain-text completion, run on the feature's configured model. */
export type ModelProviderTextGenerationInput = Readonly<{
  projectId: string;
  featureKey: string;
  system: string;
  messages: readonly ModelProviderTextMessage[];
  /** Runs this model instead of the feature's cascade, as a caller's fallback. */
  model?: string;
  maxOutputTokens?: number;
  maxRetries?: number;
  temperature?: number;
  reasoningEffort?: "low" | "medium" | "high";
}>;

const modelProviderTenantInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.projectId || value.organizationId), {
    message: "Either projectId or organizationId is required.",
  });
export interface ModelProviderTenantInputSchema extends Named<
  typeof modelProviderTenantInputSchemaDefinition
> {}
export const modelProviderTenantInputSchema: ModelProviderTenantInputSchema =
  modelProviderTenantInputSchemaDefinition;
export type ModelProviderTenantInput = z.infer<typeof modelProviderTenantInputSchema>;

const modelProviderWriteInputSchemaDefinition = modelProviderTenantInputSchema
  .safeExtend({
    id: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    provider: z.string().min(1),
    name: z.string().trim().min(1).max(128).optional(),
    enabled: z.boolean(),
    defaultModel: z.string().optional(),
    customKeys: providerCredentialSchema.nullable().optional(),
    customModels: z.array(modelSchema).nullable().optional(),
    customEmbeddingsModels: z.array(modelSchema).nullable().optional(),
    extraHeaders: z
      .array(z.object({ key: z.string(), value: z.string() }).strict())
      .nullable()
      .optional(),
    routingHandle: z.string().max(32).nullable().optional(),
    langySkipPermissionsModels: z.array(z.string()).nullable().optional(),
    scopes: z.array(modelProviderScopeSchema).min(1).optional(),
    rateLimitRpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitTpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitRpd: z.number().int().nonnegative().nullable().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();
export interface ModelProviderWriteInputSchema extends Named<
  typeof modelProviderWriteInputSchemaDefinition
> {}
export const modelProviderWriteInputSchema: ModelProviderWriteInputSchema =
  modelProviderWriteInputSchemaDefinition;
export type ModelProviderWriteInput = z.infer<typeof modelProviderWriteInputSchema>;

const modelProviderDeleteInputSchemaDefinition = modelProviderTenantInputSchema
  .safeExtend({
    id: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    provider: z.string().min(1),
  })
  .strict();
export interface ModelProviderDeleteInputSchema extends Named<
  typeof modelProviderDeleteInputSchemaDefinition
> {}
export const modelProviderDeleteInputSchema: ModelProviderDeleteInputSchema =
  modelProviderDeleteInputSchemaDefinition;
export type ModelProviderDeleteInput = z.infer<typeof modelProviderDeleteInputSchema>;

const modelProviderListProjectInputSchemaDefinition = z
  .object({ projectId: z.string().min(1) })
  .strict();
export interface ModelProviderListProjectInputSchema extends Named<
  typeof modelProviderListProjectInputSchemaDefinition
> {}
export const modelProviderListProjectInputSchema: ModelProviderListProjectInputSchema =
  modelProviderListProjectInputSchemaDefinition;
export type ModelProviderListProjectInput = z.infer<typeof modelProviderListProjectInputSchema>;
const modelDefaultSnapshotInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), actorId: z.string().min(1).optional() })
  .strict();
export interface ModelDefaultSnapshotInputSchema extends Named<
  typeof modelDefaultSnapshotInputSchemaDefinition
> {}
export const modelDefaultSnapshotInputSchema: ModelDefaultSnapshotInputSchema =
  modelDefaultSnapshotInputSchemaDefinition;
export type ModelDefaultSnapshotInput = z.infer<typeof modelDefaultSnapshotInputSchema>;
const modelProviderListOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface ModelProviderListOrganizationInputSchema extends Named<
  typeof modelProviderListOrganizationInputSchemaDefinition
> {}
export const modelProviderListOrganizationInputSchema: ModelProviderListOrganizationInputSchema =
  modelProviderListOrganizationInputSchemaDefinition;
export type ModelProviderListOrganizationInput = z.infer<
  typeof modelProviderListOrganizationInputSchema
>;

const modelProviderTestConnectionInputSchemaDefinition = modelProviderTenantInputSchema
  .safeExtend({
    actorId: z.string().min(1).optional(),
    modelProviderId: z.string().min(1),
  })
  .strict();
export interface ModelProviderTestConnectionInputSchema extends Named<
  typeof modelProviderTestConnectionInputSchemaDefinition
> {}
export const modelProviderTestConnectionInputSchema: ModelProviderTestConnectionInputSchema =
  modelProviderTestConnectionInputSchemaDefinition;
export type ModelProviderTestConnectionInput = z.infer<
  typeof modelProviderTestConnectionInputSchema
>;

/**
 * Why a credential check never reached the provider. These used to be indistinguishable from a
 * pass, which was safe for exactly as long as the answer stayed inside the save path: a skip
 * should not block a save, so `valid: true` was the right thing to return.
 */
export const modelProviderUncheckedReasonSchema = z.enum([
  /** Complex or non-probeable auth — AWS, gcloud, subscription-key services. */
  "provider_not_probeable",
  /** The stored key came back as the masked placeholder, not a credential. */
  "credential_masked",
  /** Nothing is stored and no environment variable supplies one. */
  "no_credential",
  /** No endpoint is known or configured, so there is nowhere to ask. */
  "no_endpoint",
  /** Not a provider in the registry. */
  "unknown_provider",
]);
export type ModelProviderUncheckedReason = z.infer<typeof modelProviderUncheckedReasonSchema>;

/**
 * The answer to "does this credential work". Three verdicts, not two, and the third is why this
 * type lives in the contract rather than behind the service that produces it.
 * no is a successful question, and ADR-045 reserves throwing for the absence
 */
const modelProviderCredentialVerdictSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("verified"), valid: z.literal(true) }).strict(),
  z
    .object({
      outcome: z.literal("refused"),
      valid: z.literal(false),
      domainError: serializedHandledErrorSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("unchecked"),
      valid: z.literal(true),
      reason: modelProviderUncheckedReasonSchema,
    })
    .strict(),
]);
export interface ModelProviderCredentialVerdictSchema extends Named<
  typeof modelProviderCredentialVerdictSchemaDefinition
> {}
export const modelProviderCredentialVerdictSchema: ModelProviderCredentialVerdictSchema =
  modelProviderCredentialVerdictSchemaDefinition;
export type ModelProviderCredentialVerdict = z.infer<typeof modelProviderCredentialVerdictSchema>;

const modelProviderCodexStatusInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export interface ModelProviderCodexStatusInputSchema extends Named<
  typeof modelProviderCodexStatusInputSchemaDefinition
> {}
export const modelProviderCodexStatusInputSchema: ModelProviderCodexStatusInputSchema =
  modelProviderCodexStatusInputSchemaDefinition;
export type ModelProviderCodexStatusInput = z.infer<typeof modelProviderCodexStatusInputSchema>;

const modelProviderCodexStatusSchemaDefinition = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }).strict(),
  z
    .object({
      connected: z.literal(true),
      providerId: z.string().min(1),
      plan: z.string(),
    })
    .strict(),
]);
export interface ModelProviderCodexStatusSchema extends Named<
  typeof modelProviderCodexStatusSchemaDefinition
> {}
export const modelProviderCodexStatusSchema: ModelProviderCodexStatusSchema =
  modelProviderCodexStatusSchemaDefinition;
export type ModelProviderCodexStatus = z.infer<typeof modelProviderCodexStatusSchema>;

/** Internal gateway recovery for a Codex provider credential. */
const modelProviderCodexGatewayRefreshInputSchemaDefinition = z
  .object({ providerRowId: z.string().min(1) })
  .strict();
export interface ModelProviderCodexGatewayRefreshInputSchema extends Named<
  typeof modelProviderCodexGatewayRefreshInputSchemaDefinition
> {}
export const modelProviderCodexGatewayRefreshInputSchema: ModelProviderCodexGatewayRefreshInputSchema =
  modelProviderCodexGatewayRefreshInputSchemaDefinition;
export type ModelProviderCodexGatewayRefreshInput = z.infer<
  typeof modelProviderCodexGatewayRefreshInputSchema
>;

const modelProviderCodexGatewayRefreshSchemaDefinition = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("refreshed"),
      accessToken: z.string().min(1),
      accountId: z.string(),
    })
    .strict(),
  z.object({ status: z.literal("not_connected") }).strict(),
  z.object({ status: z.literal("session_expired") }).strict(),
]);
export interface ModelProviderCodexGatewayRefreshSchema extends Named<
  typeof modelProviderCodexGatewayRefreshSchemaDefinition
> {}
export const modelProviderCodexGatewayRefreshSchema: ModelProviderCodexGatewayRefreshSchema =
  modelProviderCodexGatewayRefreshSchemaDefinition;
export type ModelProviderCodexGatewayRefresh = z.infer<
  typeof modelProviderCodexGatewayRefreshSchema
>;

const modelProviderApiKeyValidationInputSchemaDefinition = modelProviderTenantInputSchema
  .safeExtend({
    provider: z.string().min(1),
    customKeys: providerCredentialSchema,
  })
  .strict();
export interface ModelProviderApiKeyValidationInputSchema extends Named<
  typeof modelProviderApiKeyValidationInputSchemaDefinition
> {}
export const modelProviderApiKeyValidationInputSchema: ModelProviderApiKeyValidationInputSchema =
  modelProviderApiKeyValidationInputSchemaDefinition;
export type ModelProviderApiKeyValidationInput = z.infer<
  typeof modelProviderApiKeyValidationInputSchema
>;

const modelProviderApiKeyValidationSchemaDefinition = z
  .object({ valid: z.boolean(), message: z.string().optional() })
  .strict();
export interface ModelProviderApiKeyValidationSchema extends Named<
  typeof modelProviderApiKeyValidationSchemaDefinition
> {}
export const modelProviderApiKeyValidationSchema: ModelProviderApiKeyValidationSchema =
  modelProviderApiKeyValidationSchemaDefinition;
export type ModelProviderApiKeyValidation = z.infer<typeof modelProviderApiKeyValidationSchema>;

export const modelDefaultScopeSchema = modelProviderScopeSchema;
export type ModelDefaultScope = ModelProviderScope;
const modelDefaultConfigSchemaDefinition = z
  .object({
    id: z.string().min(1),
    config: z.record(z.string(), z.string()),
    scopes: z.array(modelDefaultScopeSchema),
    authorId: z.string().nullable(),
    createdAt: z.date(),
    updatedAt: z.date().optional(),
    organizationId: z.string().min(1).optional(),
  })
  .strict();
export interface ModelDefaultConfigSchema extends Named<
  typeof modelDefaultConfigSchemaDefinition
> {}
export const modelDefaultConfigSchema: ModelDefaultConfigSchema =
  modelDefaultConfigSchemaDefinition;
export type ModelDefaultConfig = z.infer<typeof modelDefaultConfigSchema>;

const modelDefaultEffectiveSchemaDefinition = z
  .object({
    model: z.string().min(1),
    source: z.enum(["feature_override", "role_default", "inferred"]),
    scope: z.enum(["project", "team", "organization"]).nullable(),
    inferredFromProvider: z.string().optional(),
  })
  .strict();
export interface ModelDefaultEffectiveSchema extends Named<
  typeof modelDefaultEffectiveSchemaDefinition
> {}
export const modelDefaultEffectiveSchema: ModelDefaultEffectiveSchema =
  modelDefaultEffectiveSchemaDefinition;
export type ModelDefaultEffective = z.infer<typeof modelDefaultEffectiveSchema>;

const modelDefaultConfigSnapshotSchemaDefinition = z
  .object({
    id: z.string().min(1),
    config: z.record(z.string(), z.string()),
    createdAt: z.date(),
    updatedAt: z.date(),
    authorId: z.string().nullable(),
    scopes: z.array(
      z
        .object({
          type: modelProviderScopeTypeSchema,
          id: z.string().min(1),
          name: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export interface ModelDefaultConfigSnapshotSchema extends Named<
  typeof modelDefaultConfigSnapshotSchemaDefinition
> {}
export const modelDefaultConfigSnapshotSchema: ModelDefaultConfigSnapshotSchema =
  modelDefaultConfigSnapshotSchemaDefinition;
export type ModelDefaultConfigSnapshot = z.infer<typeof modelDefaultConfigSnapshotSchema>;

const modelDefaultAvailableScopesSchemaDefinition = z
  .object({
    organization: z.object({ id: z.string(), name: z.string() }).nullable(),
    teams: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() }).strict()),
  })
  .strict();
export interface ModelDefaultAvailableScopesSchema extends Named<
  typeof modelDefaultAvailableScopesSchemaDefinition
> {}
export const modelDefaultAvailableScopesSchema: ModelDefaultAvailableScopesSchema =
  modelDefaultAvailableScopesSchemaDefinition;
export type ModelDefaultAvailableScopes = z.infer<typeof modelDefaultAvailableScopesSchema>;

const modelDefaultFeatureSchemaDefinition = z
  .object({
    key: z.string(),
    role: z.enum(["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"]),
    displayName: z.string(),
    description: z.string(),
  })
  .strict();
export interface ModelDefaultFeatureSchema extends Named<
  typeof modelDefaultFeatureSchemaDefinition
> {}
export const modelDefaultFeatureSchema: ModelDefaultFeatureSchema =
  modelDefaultFeatureSchemaDefinition;
export type ModelDefaultFeature = z.infer<typeof modelDefaultFeatureSchema>;

const modelDefaultSnapshotSchemaDefinition = z
  .object({
    projectId: z.string(),
    teamId: z.string().nullable(),
    organizationId: z.string().nullable(),
    organizationName: z.string().nullable(),
    effective: z.record(z.string(), modelDefaultEffectiveSchema.nullable()),
    configs: z.array(modelDefaultConfigSnapshotSchema),
    available: modelDefaultAvailableScopesSchema,
    features: z.array(modelDefaultFeatureSchema),
  })
  .strict();
export interface ModelDefaultSnapshotSchema extends Named<
  typeof modelDefaultSnapshotSchemaDefinition
> {}
export const modelDefaultSnapshotSchema: ModelDefaultSnapshotSchema =
  modelDefaultSnapshotSchemaDefinition;
export type ModelDefaultSnapshot = z.infer<typeof modelDefaultSnapshotSchema>;

const modelDefaultResolveInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), featureKey: z.string().min(1) })
  .strict();
export interface ModelDefaultResolveInputSchema extends Named<
  typeof modelDefaultResolveInputSchemaDefinition
> {}
export const modelDefaultResolveInputSchema: ModelDefaultResolveInputSchema =
  modelDefaultResolveInputSchemaDefinition;
export type ModelDefaultResolveInput = z.infer<typeof modelDefaultResolveInputSchema>;

export const modelProviderResolutionScopeSchema = z.enum(["project", "team", "organization"]);
export type ModelProviderResolutionScope = z.infer<typeof modelProviderResolutionScopeSchema>;
export const modelProviderResolutionSourceSchema = z.enum(["feature_override", "role_default"]);
export type ModelProviderResolutionSource = z.infer<typeof modelProviderResolutionSourceSchema>;
const modelProviderResolutionFeatureSchemaDefinition = z
  .object({
    key: z.string().min(1),
    role: z.enum(["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"]),
    displayName: z.string().min(1),
    description: z.string(),
  })
  .strict();
export interface ModelProviderResolutionFeatureSchema extends Named<
  typeof modelProviderResolutionFeatureSchemaDefinition
> {}
export const modelProviderResolutionFeatureSchema: ModelProviderResolutionFeatureSchema =
  modelProviderResolutionFeatureSchemaDefinition;
const modelProviderResolutionSchemaDefinition = z
  .object({
    model: z.string().min(1),
    source: modelProviderResolutionSourceSchema,
    scope: modelProviderResolutionScopeSchema,
    feature: modelProviderResolutionFeatureSchema,
  })
  .strict();
export interface ModelProviderResolutionSchema extends Named<
  typeof modelProviderResolutionSchemaDefinition
> {}
export const modelProviderResolutionSchema: ModelProviderResolutionSchema =
  modelProviderResolutionSchemaDefinition;
export type ModelProviderResolution = z.infer<typeof modelProviderResolutionSchema>;
export const modelProviderAlternateResolutionSchema = modelProviderResolutionSchema;
export type ModelProviderAlternateResolution = ModelProviderResolution;
const modelDefaultAssignmentInputSchemaDefinition = z
  .object({
    scope: modelDefaultScopeSchema,
    key: z.string().min(1),
    model: z.string().min(1).nullable(),
    authorId: z.string().nullable().optional(),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export interface ModelDefaultAssignmentInputSchema extends Named<
  typeof modelDefaultAssignmentInputSchemaDefinition
> {}
export const modelDefaultAssignmentInputSchema: ModelDefaultAssignmentInputSchema =
  modelDefaultAssignmentInputSchemaDefinition;
export type ModelDefaultAssignmentInput = z.infer<typeof modelDefaultAssignmentInputSchema>;
const modelDefaultConfigWriteInputSchemaDefinition = z
  .object({
    id: z.string().min(1).optional(),
    config: z.record(z.string(), z.string()).optional(),
    scopes: z.array(modelDefaultScopeSchema).optional(),
    authorId: z.string().nullable().optional(),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export interface ModelDefaultConfigWriteInputSchema extends Named<
  typeof modelDefaultConfigWriteInputSchemaDefinition
> {}
export const modelDefaultConfigWriteInputSchema: ModelDefaultConfigWriteInputSchema =
  modelDefaultConfigWriteInputSchemaDefinition;
export type ModelDefaultConfigWriteInput = z.infer<typeof modelDefaultConfigWriteInputSchema>;

/**
 * The API key a model-defaults write arrived on. A key's own decision is its
 * scope restrictions intersected with what its owner may still do, which is
 * why the credential is carried instead of only the person behind it.
 */
const modelDefaultApiKeyPrincipalSchemaDefinition = z
  .object({
    apiKeyId: z.string().min(1),
    userId: z.string().nullable(),
    organizationId: z.string().min(1),
  })
  .strict();
export interface ModelDefaultApiKeyPrincipalSchema extends Named<
  typeof modelDefaultApiKeyPrincipalSchemaDefinition
> {}
export const modelDefaultApiKeyPrincipalSchema: ModelDefaultApiKeyPrincipalSchema =
  modelDefaultApiKeyPrincipalSchemaDefinition;
export type ModelDefaultApiKeyPrincipal = z.infer<typeof modelDefaultApiKeyPrincipalSchema>;

const modelDefaultApiKeyScopeCheckSchemaDefinition = z
  .object({
    apiKey: modelDefaultApiKeyPrincipalSchema,
    scopes: z.array(modelDefaultScopeSchema),
  })
  .strict();
export interface ModelDefaultApiKeyScopeCheckSchema extends Named<
  typeof modelDefaultApiKeyScopeCheckSchemaDefinition
> {}
export const modelDefaultApiKeyScopeCheckSchema: ModelDefaultApiKeyScopeCheckSchema =
  modelDefaultApiKeyScopeCheckSchemaDefinition;
export type ModelDefaultApiKeyScopeCheck = z.infer<typeof modelDefaultApiKeyScopeCheckSchema>;

const modelDefaultDeleteInputSchemaDefinition = z
  .object({ id: z.string().min(1), actorId: z.string().min(1).optional() })
  .strict();
export interface ModelDefaultDeleteInputSchema extends Named<
  typeof modelDefaultDeleteInputSchemaDefinition
> {}
export const modelDefaultDeleteInputSchema: ModelDefaultDeleteInputSchema =
  modelDefaultDeleteInputSchemaDefinition;
export type ModelDefaultDeleteInput = z.infer<typeof modelDefaultDeleteInputSchema>;

const modelDefaultInheritedValuesSchemaDefinition = z
  .object({
    inherited: z.record(z.string(), modelDefaultEffectiveSchema.nullable()),
    referenceScope: modelDefaultScopeSchema,
  })
  .strict();
export interface ModelDefaultInheritedValuesSchema extends Named<
  typeof modelDefaultInheritedValuesSchemaDefinition
> {}
export const modelDefaultInheritedValuesSchema: ModelDefaultInheritedValuesSchema =
  modelDefaultInheritedValuesSchemaDefinition;
export type ModelDefaultInheritedValues = z.infer<typeof modelDefaultInheritedValuesSchema>;

const modelCostSchemaDefinition = z
  .object({
    id: z.string().min(1),
    organizationId: z.string().min(1),
    projectId: z.string().nullable().optional(),
    scopeType: modelProviderScopeTypeSchema,
    scopeId: z.string().min(1),
    model: z.string().min(1),
    regex: z.string().min(1),
    inputCostPerToken: z.number().nullable(),
    outputCostPerToken: z.number().nullable(),
    cacheReadCostPerToken: z.number().nullable(),
    cacheCreationCostPerToken: z.number().nullable(),
    cacheCreation1hCostPerToken: z.number().nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export interface ModelCostSchema extends Named<typeof modelCostSchemaDefinition> {}
export const modelCostSchema: ModelCostSchema = modelCostSchemaDefinition;
export type ModelCost = z.infer<typeof modelCostSchema>;

/** A catalog rate used to price one observed model invocation. */
const modelCostRateSchemaDefinition = z
  .object({
    model: z.string(),
    regex: z.string(),
    inputCostPerToken: z.number().optional(),
    outputCostPerToken: z.number().optional(),
    cacheReadCostPerToken: z.number().optional(),
    cacheCreationCostPerToken: z.number().optional(),
    cacheCreation1hCostPerToken: z.number().optional(),
    inputAudioCostPerToken: z.number().optional(),
    outputAudioCostPerToken: z.number().optional(),
    // Per-token rates for image tokens on the token-billed image models. OpenAI bills gpt-image
    // output image tokens at $30 to $40 per million against $5 for text input, so an image
    // priced off a flat token total comes out a fraction of what it cost. The counts these
    // price are disjoint from the text token counts and, unlike the audio rates, there is no
    // text fallback.
    inputImageCostPerToken: z.number().optional(),
    outputImageCostPerToken: z.number().optional(),
    inputCostPerCharacter: z.number().optional(),
    inputCostPerSecond: z.number().optional(),
  })
  .strict();
export interface ModelCostRateSchema extends Named<typeof modelCostRateSchemaDefinition> {}
export const modelCostRateSchema: ModelCostRateSchema = modelCostRateSchemaDefinition;
export type ModelCostRate = z.infer<typeof modelCostRateSchema>;

/** A catalogue rate listed beside the stored rules; `projectId: ""` is main's wire for it. */
const modelCostCatalogueRowSchemaDefinition = modelCostRateSchema.safeExtend({
  projectId: z.literal(""),
});
export interface ModelCostCatalogueRowSchema extends Named<
  typeof modelCostCatalogueRowSchemaDefinition
> {}
export const modelCostCatalogueRowSchema: ModelCostCatalogueRowSchema =
  modelCostCatalogueRowSchemaDefinition;
export type ModelCostCatalogueRow = z.infer<typeof modelCostCatalogueRowSchema>;

/** One row of the model-costs listing: a stored rule (with an id) or a catalogue rate (without). */
const modelCostListRowSchemaDefinition = z.union([modelCostSchema, modelCostCatalogueRowSchema]);
export interface ModelCostListRowSchema extends Named<typeof modelCostListRowSchemaDefinition> {}
export const modelCostListRowSchema: ModelCostListRowSchema = modelCostListRowSchemaDefinition;
export type ModelCostListRow = z.infer<typeof modelCostListRowSchema>;

/** Canonical inputs for the shared trace/gateway model-pricing cascade. */
const modelCostEstimateInputSchemaDefinition = z
  .object({
    attrs: z.record(z.string(), z.unknown()),
    model: z.string().optional(),
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
  })
  .strict();
export interface ModelCostEstimateInputSchema extends Named<
  typeof modelCostEstimateInputSchemaDefinition
> {}
export const modelCostEstimateInputSchema: ModelCostEstimateInputSchema =
  modelCostEstimateInputSchemaDefinition;
export type ModelCostEstimateInput = z.infer<typeof modelCostEstimateInputSchema>;
const modelCostListInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface ModelCostListInputSchema extends Named<
  typeof modelCostListInputSchemaDefinition
> {}
export const modelCostListInputSchema: ModelCostListInputSchema =
  modelCostListInputSchemaDefinition;
export type ModelCostListInput = z.infer<typeof modelCostListInputSchema>;
const modelCostWriteInputSchemaDefinition = z
  .object({
    id: z.string().min(1).optional(),
    projectId: z.string().min(1),
    actorId: z.string().min(1).optional(),
    scopeType: modelProviderScopeTypeSchema.optional(),
    scopeId: z.string().min(1).optional(),
    model: z.string().min(1),
    regex: z.string().min(1),
    inputCostPerToken: z.number().nullable().optional(),
    outputCostPerToken: z.number().nullable().optional(),
    cacheReadCostPerToken: z.number().nullable().optional(),
    cacheCreationCostPerToken: z.number().nullable().optional(),
    cacheCreation1hCostPerToken: z.number().nullable().optional(),
  })
  .strict();
export interface ModelCostWriteInputSchema extends Named<
  typeof modelCostWriteInputSchemaDefinition
> {}
export const modelCostWriteInputSchema: ModelCostWriteInputSchema =
  modelCostWriteInputSchemaDefinition;
export type ModelCostWriteInput = z.infer<typeof modelCostWriteInputSchema>;
const modelCostDeleteInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    id: z.string().min(1),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export interface ModelCostDeleteInputSchema extends Named<
  typeof modelCostDeleteInputSchemaDefinition
> {}
export const modelCostDeleteInputSchema: ModelCostDeleteInputSchema =
  modelCostDeleteInputSchemaDefinition;
export type ModelCostDeleteInput = z.infer<typeof modelCostDeleteInputSchema>;

const translateInputSchemaDefinition = z
  .object({ projectId: z.string().min(1), text: z.string().max(100_000) })
  .strict();
export interface TranslateInputSchema extends Named<typeof translateInputSchemaDefinition> {}
export const translateInputSchema: TranslateInputSchema = translateInputSchemaDefinition;
export type TranslateInput = z.infer<typeof translateInputSchema>;
const translateOutputSchemaDefinition = z.object({ translation: z.string() }).strict();
export interface TranslateOutputSchema extends Named<typeof translateOutputSchemaDefinition> {}
export const translateOutputSchema: TranslateOutputSchema = translateOutputSchemaDefinition;
export type TranslateOutput = z.infer<typeof translateOutputSchema>;

/** Whether any of a project's model providers is switched on. */
export function hasEnabledModelProvider(
  providers: Readonly<Record<string, { enabled: boolean }>>,
): boolean {
  return Object.values(providers).some((provider) => provider.enabled);
}

export const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
export const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const CODEX_VERIFICATION_URL = `${CODEX_OAUTH_ISSUER}/codex/device`;
export const CODEX_SIGN_IN_TTL_MS = 15 * 60 * 1000;

const codexTokenKeysSchemaDefinition = z
  .object({
    CODEX_ACCESS_TOKEN: z.string().min(1),
    CODEX_REFRESH_TOKEN: z.string().min(1),
    CODEX_ID_TOKEN: z.string(),
    CODEX_ACCOUNT_ID: z.string(),
    CODEX_PLAN: z.string(),
    CODEX_EMAIL: z.string(),
    CODEX_TOKENS_SAVED_AT: z.string(),
  })
  .strict();
export interface CodexTokenKeysSchema extends Named<typeof codexTokenKeysSchemaDefinition> {}
export const codexTokenKeysSchema: CodexTokenKeysSchema = codexTokenKeysSchemaDefinition;
export type CodexTokenKeys = z.infer<typeof codexTokenKeysSchema>;
