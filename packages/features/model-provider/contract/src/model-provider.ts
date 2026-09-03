import { serializedHandledErrorSchema } from "@langwatch/handled-error";
import { z } from "zod";

export const MODEL_PROVIDER_FEATURE_ID = "model-provider" as const;
export const DEFAULT_AZURE_API_VERSION = "2025-04-01-preview";
export const ROUTING_HANDLE_MAX_LENGTH = 32;
export const ROUTING_HANDLE_RULE = `A routing handle starts with a letter or a number, then uses only letters, numbers, hyphens and underscores, up to ${ROUTING_HANDLE_MAX_LENGTH} characters.`;
export const MODEL_PROVIDER_SCOPE_TYPES = ["ORGANIZATION", "TEAM", "PROJECT"] as const;
export const modelProviderScopeTypeSchema = z.enum(MODEL_PROVIDER_SCOPE_TYPES);
export type ModelProviderScopeType = z.infer<typeof modelProviderScopeTypeSchema>;

export const modelProviderScopeSchema = z
  .object({
    scopeType: modelProviderScopeTypeSchema,
    scopeId: z.string().min(1),
  })
  .strict();
export type ModelProviderScope = z.infer<typeof modelProviderScopeSchema>;

export const modelSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    type: z.enum(["chat", "embedding", "other"]),
    maxTokens: z.number().positive().nullable().optional(),
    supportedParameters: z.array(z.string()).optional(),
    multimodalInputs: z.array(z.enum(["image", "file", "audio"])).optional(),
  })
  .strict();
export type Model = z.infer<typeof modelSchema>;

export const providerCredentialSchema = z.record(z.string(), z.unknown());
export const modelProviderSchema = z
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
    deploymentMapping: z.record(z.string(), z.string()).nullable().optional(),
    healthStatus: z.enum(["UNKNOWN", "HEALTHY", "DEGRADED", "CIRCUIT_OPEN"]).optional(),
    circuitOpenedAt: z.date().nullable().optional(),
    lastHealthCheckAt: z.date().nullable().optional(),
    disabledAt: z.date().nullable().optional(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();
export type ModelProvider = z.infer<typeof modelProviderSchema>;

export const modelProviderSummarySchema = modelProviderSchema
  .extend({
    models: z.array(z.string()).nullable().optional(),
    embeddingsModels: z.array(z.string()).nullable().optional(),
    deploymentMapping: z.record(z.string(), z.string()).nullable().optional(),
    disabledByDefault: z.boolean().optional(),
    customKeys: providerCredentialSchema.nullable(),
    isSystem: z.boolean().default(false),
    embeddingsUnsupported: z.boolean().default(false),
  })
  .strict();
export type ModelProviderSummary = z.infer<typeof modelProviderSummarySchema>;

/** Server-only provider value used to build model execution parameters. */
export const modelProviderExecutionSchema = modelProviderSchema
  .extend({
    models: z.array(z.string()).nullable(),
    embeddingsModels: z.array(z.string()).nullable(),
    disabledByDefault: z.boolean().optional(),
    isSystem: z.boolean(),
    embeddingsUnsupported: z.boolean(),
  })
  .strict();
export type ModelProviderExecution = z.infer<typeof modelProviderExecutionSchema>;

/** Input for the server-side LiteLLM/NLP execution parameter preparation. */
export const modelProviderExecutionPrepareInputSchema = z
  .object({
    projectId: z.string().min(1),
    model: z.string().min(1),
  })
  .strict();
export type ModelProviderExecutionPrepareInput = z.infer<
  typeof modelProviderExecutionPrepareInputSchema
>;

/** Portable key/value parameters consumed by LiteLLM-compatible runners. */
export const modelProviderExecutionParametersSchema = z.record(z.string(), z.string());
export type ModelProviderExecutionParameters = z.infer<
  typeof modelProviderExecutionParametersSchema
>;

export const modelProviderTenantInputSchema = z
  .object({
    projectId: z.string().min(1).optional(),
    organizationId: z.string().min(1).optional(),
  })
  .strict()
  .refine((value) => Boolean(value.projectId || value.organizationId), {
    message: "Either projectId or organizationId is required.",
  });
export type ModelProviderTenantInput = z.infer<typeof modelProviderTenantInputSchema>;

export const modelProviderWriteInputSchema = modelProviderTenantInputSchema
  .extend({
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
    scopes: z.array(modelProviderScopeSchema).min(1).optional(),
    rateLimitRpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitTpm: z.number().int().nonnegative().nullable().optional(),
    rateLimitRpd: z.number().int().nonnegative().nullable().optional(),
    fallbackPriorityGlobal: z.number().int().nullable().optional(),
    providerConfig: z.record(z.string(), z.unknown()).nullable().optional(),
  })
  .strict();
export type ModelProviderWriteInput = z.infer<typeof modelProviderWriteInputSchema>;

export const modelProviderDeleteInputSchema = modelProviderTenantInputSchema
  .extend({
    id: z.string().min(1).optional(),
    actorId: z.string().min(1).optional(),
    provider: z.string().min(1),
  })
  .strict();
export type ModelProviderDeleteInput = z.infer<typeof modelProviderDeleteInputSchema>;

export const modelProviderListProjectInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type ModelProviderListProjectInput = z.infer<typeof modelProviderListProjectInputSchema>;
export const modelDefaultSnapshotInputSchema = z
  .object({ projectId: z.string().min(1), actorId: z.string().min(1).optional() })
  .strict();
export type ModelDefaultSnapshotInput = z.infer<typeof modelDefaultSnapshotInputSchema>;
export const modelProviderListOrganizationInputSchema = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export type ModelProviderListOrganizationInput = z.infer<
  typeof modelProviderListOrganizationInputSchema
>;

export const modelProviderTestConnectionInputSchema = modelProviderTenantInputSchema
  .extend({
    actorId: z.string().min(1).optional(),
    modelProviderId: z.string().min(1),
  })
  .strict();
export type ModelProviderTestConnectionInput = z.infer<
  typeof modelProviderTestConnectionInputSchema
>;

/**
 * Why a credential check never reached the provider.
 *
 * These used to be indistinguishable from a pass, which was safe for exactly
 * as long as the answer stayed inside the save path: a skip should not block
 * a save, so `valid: true` was the right thing to return. Put the same value
 * in front of a customer and it becomes a claim we cannot support — six of
 * the sixteen registered providers reach one of these paths, so a control
 * that read `valid` alone would report more than a third of the list as
 * working without having sent a packet.
 *
 * `valid` still says what the save path needs. `outcome` says what a reader
 * needs. Neither has to lie for the other.
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
 * The answer to "does this credential work".
 *
 * Three verdicts, not two, and the third is why this type lives in the
 * contract rather than behind the service that produces it. "We could not
 * check this" is an answer, not a soft yes, and a reader that collapses it
 * into a boolean reports a third of the provider list as working without
 * having sent a packet. The packaged transport and the browser both read this
 * declaration, so neither can drift from the other by restating it.
 *
 * A refusal travels as a serialized `HandledError`, not as a sentence. It is
 * still a RETURN value rather than a throw — asking a provider and being told
 * no is a successful question, and ADR-045 reserves throwing for the absence
 * of an answer — but the words the customer reads come from the code-keyed
 * registry in `features/errors`, the same as every other failure in the app.
 */
export const modelProviderCredentialVerdictSchema = z.discriminatedUnion("outcome", [
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
export type ModelProviderCredentialVerdict = z.infer<typeof modelProviderCredentialVerdictSchema>;

export const modelProviderCodexStatusInputSchema = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export type ModelProviderCodexStatusInput = z.infer<typeof modelProviderCodexStatusInputSchema>;

export const modelProviderCodexStatusSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }).strict(),
  z
    .object({
      connected: z.literal(true),
      providerId: z.string().min(1),
      plan: z.string(),
    })
    .strict(),
]);
export type ModelProviderCodexStatus = z.infer<typeof modelProviderCodexStatusSchema>;

/** Internal gateway recovery for a Codex provider credential. */
export const modelProviderCodexGatewayRefreshInputSchema = z
  .object({ providerRowId: z.string().min(1) })
  .strict();
export type ModelProviderCodexGatewayRefreshInput = z.infer<
  typeof modelProviderCodexGatewayRefreshInputSchema
>;

export const modelProviderCodexGatewayRefreshSchema = z.discriminatedUnion("status", [
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
export type ModelProviderCodexGatewayRefresh = z.infer<
  typeof modelProviderCodexGatewayRefreshSchema
>;

export const modelProviderApiKeyValidationInputSchema = modelProviderTenantInputSchema
  .extend({
    provider: z.string().min(1),
    customKeys: providerCredentialSchema,
  })
  .strict();
export type ModelProviderApiKeyValidationInput = z.infer<
  typeof modelProviderApiKeyValidationInputSchema
>;

export const modelProviderApiKeyValidationSchema = z
  .object({ valid: z.boolean(), message: z.string().optional() })
  .strict();
export type ModelProviderApiKeyValidation = z.infer<typeof modelProviderApiKeyValidationSchema>;

export const modelDefaultScopeSchema = modelProviderScopeSchema;
export type ModelDefaultScope = ModelProviderScope;
export const modelDefaultConfigSchema = z
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
export type ModelDefaultConfig = z.infer<typeof modelDefaultConfigSchema>;

export const modelDefaultEffectiveSchema = z
  .object({
    model: z.string().min(1),
    source: z.enum(["feature_override", "role_default", "inferred"]),
    scope: z.enum(["project", "team", "organization"]).nullable(),
    inferredFromProvider: z.string().optional(),
  })
  .strict();
export type ModelDefaultEffective = z.infer<typeof modelDefaultEffectiveSchema>;

export const modelDefaultConfigSnapshotSchema = z
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
export type ModelDefaultConfigSnapshot = z.infer<typeof modelDefaultConfigSnapshotSchema>;

export const modelDefaultAvailableScopesSchema = z
  .object({
    organization: z.object({ id: z.string(), name: z.string() }).nullable(),
    teams: z.array(z.object({ id: z.string(), name: z.string() }).strict()),
    projects: z.array(z.object({ id: z.string(), name: z.string(), teamId: z.string() }).strict()),
  })
  .strict();
export type ModelDefaultAvailableScopes = z.infer<typeof modelDefaultAvailableScopesSchema>;

export const modelDefaultFeatureSchema = z
  .object({
    key: z.string(),
    role: z.enum(["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"]),
    displayName: z.string(),
    description: z.string(),
  })
  .strict();
export type ModelDefaultFeature = z.infer<typeof modelDefaultFeatureSchema>;

export const modelDefaultSnapshotSchema = z
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
export type ModelDefaultSnapshot = z.infer<typeof modelDefaultSnapshotSchema>;

export const modelDefaultResolveInputSchema = z
  .object({ projectId: z.string().min(1), featureKey: z.string().min(1) })
  .strict();
export type ModelDefaultResolveInput = z.infer<typeof modelDefaultResolveInputSchema>;

export const modelProviderResolutionScopeSchema = z.enum(["project", "team", "organization"]);
export type ModelProviderResolutionScope = z.infer<typeof modelProviderResolutionScopeSchema>;
export const modelProviderResolutionSourceSchema = z.enum(["feature_override", "role_default"]);
export type ModelProviderResolutionSource = z.infer<typeof modelProviderResolutionSourceSchema>;
export const modelProviderResolutionFeatureSchema = z
  .object({
    key: z.string().min(1),
    role: z.enum(["DEFAULT", "FAST", "LANGY", "EMBEDDINGS"]),
    displayName: z.string().min(1),
    description: z.string(),
  })
  .strict();
export const modelProviderResolutionSchema = z
  .object({
    model: z.string().min(1),
    source: modelProviderResolutionSourceSchema,
    scope: modelProviderResolutionScopeSchema,
    feature: modelProviderResolutionFeatureSchema,
  })
  .strict();
export type ModelProviderResolution = z.infer<typeof modelProviderResolutionSchema>;
export const modelProviderAlternateResolutionSchema = modelProviderResolutionSchema;
export type ModelProviderAlternateResolution = ModelProviderResolution;
export const modelDefaultAssignmentInputSchema = z
  .object({
    scope: modelDefaultScopeSchema,
    key: z.string().min(1),
    model: z.string().min(1).nullable(),
    authorId: z.string().nullable().optional(),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export type ModelDefaultAssignmentInput = z.infer<typeof modelDefaultAssignmentInputSchema>;
export const modelDefaultConfigWriteInputSchema = z
  .object({
    id: z.string().min(1).optional(),
    config: z.record(z.string(), z.string()).optional(),
    scopes: z.array(modelDefaultScopeSchema).optional(),
    authorId: z.string().nullable().optional(),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export type ModelDefaultConfigWriteInput = z.infer<typeof modelDefaultConfigWriteInputSchema>;

export const modelDefaultDeleteInputSchema = z
  .object({ id: z.string().min(1), actorId: z.string().min(1).optional() })
  .strict();
export type ModelDefaultDeleteInput = z.infer<typeof modelDefaultDeleteInputSchema>;

export const modelDefaultInheritedValuesSchema = z
  .object({
    inherited: z.record(z.string(), modelDefaultEffectiveSchema.nullable()),
    referenceScope: modelDefaultScopeSchema,
  })
  .strict();
export type ModelDefaultInheritedValues = z.infer<typeof modelDefaultInheritedValuesSchema>;

export const modelCostSchema = z
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
export type ModelCost = z.infer<typeof modelCostSchema>;

/** A catalog rate used to price one observed model invocation. */
export const modelCostRateSchema = z
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
    inputCostPerCharacter: z.number().optional(),
    inputCostPerSecond: z.number().optional(),
  })
  .strict();
export type ModelCostRate = z.infer<typeof modelCostRateSchema>;

/** Canonical inputs for the shared trace/gateway model-pricing cascade. */
export const modelCostEstimateInputSchema = z
  .object({
    attrs: z.record(z.string(), z.unknown()),
    model: z.string().optional(),
    promptTokens: z.number().nullable(),
    completionTokens: z.number().nullable(),
  })
  .strict();
export type ModelCostEstimateInput = z.infer<typeof modelCostEstimateInputSchema>;
export const modelCostListInputSchema = z.object({ projectId: z.string().min(1) }).strict();
export type ModelCostListInput = z.infer<typeof modelCostListInputSchema>;
export const modelCostWriteInputSchema = z
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
export type ModelCostWriteInput = z.infer<typeof modelCostWriteInputSchema>;
export const modelCostDeleteInputSchema = z
  .object({
    projectId: z.string().min(1),
    id: z.string().min(1),
    actorId: z.string().min(1).optional(),
  })
  .strict();
export type ModelCostDeleteInput = z.infer<typeof modelCostDeleteInputSchema>;

export const translateInputSchema = z
  .object({ projectId: z.string().min(1), text: z.string().max(100_000) })
  .strict();
export type TranslateInput = z.infer<typeof translateInputSchema>;
export const translateOutputSchema = z.object({ translation: z.string() }).strict();
export type TranslateOutput = z.infer<typeof translateOutputSchema>;
