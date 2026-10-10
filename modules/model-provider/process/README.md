# @langwatch/model-provider-process

The server half of [model-provider](../README.md). Model providers: the providers configured per project and organisation, which one serves a model, and cost estimates.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("model-provider").withRepositories(modelProviderRepositories).withChannels(modelProviderChannels).withApi(ModelProviderModule).withTransports(modelProviderRest, modelDefaultsRest, playgroundRest, modelProviderTrpcTransport, llmModelCostTrpcTransport, translateTrpcTransport).provideMiddlewareBindings(…).withTasks(…).withMigrations(…)`, `src/model-provider.module.ts:30`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ModelProviderApi`)

Callable model-provider operations shared by process peers after composition.

Peers call these through the token, declared at `../contract/src/model-provider.api.ts:194`; nothing else in this package is public.

#### `estimateCost`

```typescript
estimateCost(input: ModelCostEstimateInput): number;
```

#### `listForProject`

```typescript
listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]>;
```

#### `findAllAccessibleForProject`

Every saved row in the project's scope chain, unfiltered and keys masked; empty for a missing project.

```typescript
findAllAccessibleForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]>;
```

#### `listForOrganization`

```typescript
listForOrganization(input: ModelProviderListOrganizationInput): Promise<ModelProviderSummary[]>;
```

#### `getForProject`

```typescript
getForProject(input: ModelProviderListProjectInput & { provider?: string }): Promise<Record<string, ModelProviderSummary>>;
```

#### `findProviderForProject`

```typescript
findProviderForProject(input: { projectId: string; provider: string; }): Promise<ModelProvider | null>;
```

#### `findRowServingModel`

```typescript
findRowServingModel(input: { projectId: string; provider: string; model: string; }): Promise<ModelProvider | null>;
```

#### `getExecutionProviders`

```typescript
getExecutionProviders(input: ModelProviderListProjectInput): Promise<Record<string, ModelProviderExecution>>;
```

#### `prepareExecution`

```typescript
prepareExecution(input: ModelProviderExecutionPrepareInput): Promise<ModelProviderExecutionParameters>;
```

#### `prepareEvaluatorModelEnv`

The `X_LITELLM_*` (or `X_LITELLM_EMBEDDINGS_*`) block an evaluator calls `model` with; throws `EvaluatorConfigError` when the provider is unconfigured, disabled or does not serve the model.

```typescript
prepareEvaluatorModelEnv(input: ModelProviderEvaluatorModelEnvInput): Promise<Record<string, string>>;
```

#### `generateStructured`

Resolves a feature's configured model and returns schema-validated structured data.

```typescript
generateStructured(input: ModelProviderStructuredGenerationInput): Promise<unknown>;
```

#### `generateText`

Runs a feature's plain-text completion on its configured model. Throws `ModelNotConfiguredError` when nothing resolves, `AiCallFailedError` when the provider fails.

```typescript
generateText(input: ModelProviderTextGenerationInput): Promise<{ text: string }>;
```

#### `runPlaygroundCompletion`

Streams one browser playground completion through the configured execution proxy.

```typescript
runPlaygroundCompletion(input: ModelProviderPlaygroundRequest): Promise<ModelProviderPlaygroundCompletion>;
```

#### `upsert`

Stores or replaces a provider row and answers it with its credentials masked.

```typescript
upsert(input: ModelProviderWriteRequest, by: ModelProviderCaller): Promise<ModelProvider>;
```

#### `upsertUnattributed`

The write a project credential makes, which names no person to attribute it to and no person to authorize it against: the key's own project permission is the whole gate. Answers the row with its credentials masked.

```typescript
upsertUnattributed(input: ModelProviderWriteRequest): Promise<ModelProvider>;
```

#### `delete`

```typescript
delete(input: ModelProviderDeleteRequest, by: ModelProviderCaller): Promise<void>;
```

#### `validateApiKey`

Probes a credential the caller supplied, after checking they may write the tenant they named. Nothing downstream re-authorizes: the probe goes straight to the provider with those keys, so this check IS the authorization.

```typescript
validateApiKey(input: ModelProviderCredentialProbeRequest, by: ModelProviderCaller): Promise<ModelProviderCredentialVerdict>;
```

#### `validateStoredKey`

Probes the stored (or environment-fed) credential against a base URL.

```typescript
validateStoredKey(input: ModelProviderStoredCredentialProbeRequest): Promise<ModelProviderCredentialVerdict>;
```

#### `startCodexDeviceSignIn`

```typescript
startCodexDeviceSignIn(): Promise<ModelProviderCodexDeviceSignIn>;
```

#### `pollCodexDeviceSignIn`

```typescript
pollCodexDeviceSignIn(input: { deviceAuthId: string; userCode: string; }): Promise<ModelProviderCodexDeviceApproval>;
```

#### `completeCodexDeviceSignIn`

Polls the device sign-in; on approval saves the codex provider (and the coding defaults).

```typescript
completeCodexDeviceSignIn(input: ModelProviderCodexSignInCompletionInput, by: ModelProviderCaller): Promise<ModelProviderCodexSignInCompletion>;
```

#### `testConnection`

```typescript
testConnection(input: ModelProviderTestConnectionRequest, by: ModelProviderCaller): Promise<ModelProviderCredentialVerdict>;
```

#### `getCodexStatus`

```typescript
getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus>;
```

#### `refreshCodexForGateway`

```typescript
refreshCodexForGateway(input: ModelProviderCodexGatewayRefreshInput): Promise<ModelProviderCodexGatewayRefresh>;
```

#### `isManagedProvider`

```typescript
isManagedProvider(input: { organizationId: string; provider: string }): boolean;
```

#### `getDefaultSnapshot`

```typescript
getDefaultSnapshot(input: ModelDefaultSnapshotRequest, by: ModelProviderCaller): Promise<ModelDefaultSnapshot>;
```

#### `getDefaultSnapshotUnattributed`

The same snapshot read as nobody, for a project credential that names no person. What a snapshot shows is filtered by what its reader may see, and there is no reader here.

```typescript
getDefaultSnapshotUnattributed(input: ModelDefaultSnapshotRequest): Promise<ModelDefaultSnapshot>;
```

#### `getInheritedValues`

```typescript
getInheritedValues(input: { projectId: string; scopes: ModelDefaultScope[]; excludeConfigId?: string; }): Promise<ModelDefaultInheritedValues>;
```

#### `findResolvedDefault`

```typescript
findResolvedDefault(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null>;
```

#### `resolveModelForFeature`

```typescript
resolveModelForFeature(input: ModelDefaultResolveInput): Promise<ModelProviderResolution>;
```

#### `findAlternateModel`

```typescript
findAlternateModel(input: { projectId: string; featureKey: string; skipFromScope: ModelProviderResolution["scope"]; }): Promise<ModelProviderAlternateResolution>;
```

#### `setDefault`

```typescript
setDefault(input: ModelDefaultAssignmentRequest, by: ModelProviderCaller): Promise<void>;
```

#### `saveDefaultConfig`

```typescript
saveDefaultConfig(input: ModelDefaultConfigWriteRequest, by: ModelProviderCaller): Promise<ModelDefaultConfig>;
```

#### `assertApiKeyMayWriteDefaultScopes`

```typescript
assertApiKeyMayWriteDefaultScopes(input: ModelDefaultApiKeyScopeCheck): Promise<void>;
```

#### `findDefaultConfig`

```typescript
findDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null>;
```

#### `deleteDefaultConfig`

```typescript
deleteDefaultConfig(input: ModelDefaultDeleteRequest, by: ModelProviderCaller): Promise<void>;
```

#### `listCosts`

```typescript
listCosts(input: ModelCostListInput): Promise<ModelCost[]>;
```

#### `listCostsWithCatalogue`

Stored rules, most specific first, then every static catalogue rate: main's listing.

```typescript
listCostsWithCatalogue(input: ModelCostListInput): Promise<ModelCostListRow[]>;
```

#### `findModelLimits`

The registry's context-window and output ceilings, or null when it names no such model.

```typescript
findModelLimits(input: { model: string }): ModelLimits | null;
```

#### `previewCostRuleMatchingSpans`

What a cost rule the caller is still typing would match, over the recent window.

```typescript
previewCostRuleMatchingSpans(input: ModelCostPreviewRequest): Promise<CostRuleMatchingSpansPreview>;
```

#### `upsertCost`

```typescript
upsertCost(input: ModelCostWriteRequest, by: ModelProviderCaller): Promise<ModelCost>;
```

#### `deleteCost`

```typescript
deleteCost(input: ModelCostDeleteRequest, by: ModelProviderCaller): Promise<void>;
```

#### `translate`

```typescript
translate(input: TranslateInput): Promise<TranslateOutput>;
```

#### `applyCodexCodingDefaults`

```typescript
applyCodexCodingDefaults(input: { scopes: readonly ModelDefaultScope[] }, by: ModelProviderCaller): Promise<void>;
```

#### `platformProviderChain`

The providers this deployment holds its own keys for, in dispatch order (ADR-156 section 8); empty where it holds none. Asked by a peer dispatching on LangWatch's behalf — the gateway, for a license's managed key.

```typescript
platformProviderChain(): Promise<PlatformProviderEntry[]>;
```

#### `countEnabledInScopes`

Enabled providers attached to any of the scopes; main's personal-key eligibility count.

```typescript
countEnabledInScopes(input: { scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[]; }): Promise<number>;
```

#### `findEnabledProviderKeysInScopes`

The distinct provider keys of those same providers; main's aiTools provider availability.

```typescript
findEnabledProviderKeysInScopes(input: { scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[]; }): Promise<string[]>;
```

#### `countInOrganization`

How many of these providers sit on the organization, its teams or its projects.

```typescript
countInOrganization(input: { organizationId: string; modelProviderIds: readonly string[]; }): Promise<number>;
```

#### `countUsage`

```typescript
countUsage(input: { organizationIds: readonly string[] }): Promise<ModelProviderUsageCount>;
```

#### `getCustomKeys`

One row's decrypted custom keys, for a peer with no session to authorize with (the gateway's signed webhook and voice reconciler). Throws `ModelProviderNotFoundError` for an unknown id and `ModelProviderCustomKeysMissingError` for a row that stores none.

```typescript
getCustomKeys(input: { modelProviderId: string }): Promise<ModelProviderCustomKeys>;
```

## REST transport

### `modelDefaultsRest`

|             |                                                      |
| ----------- | ---------------------------------------------------- |
| Declared at | `src/transport/model-defaults.rest.ts:53`            |
| Base URL    | `/api/model-defaults`, twin `/api/v1/model-defaults` |
| Addressing  | dated                                                |
| Credential  | project                                              |
| Versions    | `2026-08-07`                                         |

#### `GET /` · `getApiModelDefaults`

Snapshot of the default-model cascade for this project: effective resolution per role, plus the configs the caller can read.

Permission `project:view`. Declared at `src/transport/model-defaults.rest.ts:57`.

Answers at `/api/model-defaults`, `/api/v1/model-defaults`; also, undocumented, `/api/model-defaults/2026-08-07`, `/api/v1/model-defaults/2026-08-07`, `/api/model-defaults/latest`, `/api/v1/model-defaults/latest`.

```typescript
type Response = z.infer<typeof apiResponseModelDefaultsSchema>; // ../contract/src/model-provider-rest.schemas.ts:111
```

#### `POST /` · `postApiModelDefaults`

Create a default-model config attached to one or more scopes. JSON keys may be roles (DEFAULT, FAST, LANGY, EMBEDDINGS) or registered feature keys; missing keys inherit from a higher scope.

Permission `project:manage`. Declared at `src/transport/model-defaults.rest.ts:96`.

Answers at `/api/model-defaults`, `/api/v1/model-defaults`; also, undocumented, `/api/model-defaults/2026-08-07`, `/api/v1/model-defaults/2026-08-07`, `/api/model-defaults/latest`, `/api/v1/model-defaults/latest`.

```typescript
// Body: createModelDefaultConfigInputSchema, ../contract/src/model-provider-rest.schemas.ts:74
interface Body {
  config: Record<string, string>;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
// Response: apiResponseConfigCreatedSchema, ../contract/src/model-provider-rest.schemas.ts:126
interface Response {
  id: string;
}
```

#### `PUT /:id` · `putApiModelDefaultsById`

Update a config's JSON payload and/or its scope attachments. Sending `scopes: []` deletes the config.

Permission `project:manage`. Declared at `src/transport/model-defaults.rest.ts:124`.

Answers at `/api/model-defaults/:id`, `/api/v1/model-defaults/:id`; also, undocumented, `/api/model-defaults/2026-08-07/:id`, `/api/v1/model-defaults/2026-08-07/:id`, `/api/model-defaults/latest/:id`, `/api/v1/model-defaults/latest/:id`.

```typescript
// Params: modelDefaultsRestParamsSchema, ../contract/src/model-provider-rest.schemas.ts:62
interface Params {
  id: string;
}
// Body: updateModelDefaultConfigInputSchema, ../contract/src/model-provider-rest.schemas.ts:84
interface Body {
  config?: Record<string, string>;
  scopes?: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
// Response: inline, src/transport/model-defaults.rest.ts:127
type Response = unknown;
```

#### `DELETE /:id` · `deleteApiModelDefaultsById`

Delete a default-model config. Scope attachments cascade.

Permission `project:manage`. Declared at `src/transport/model-defaults.rest.ts:157`.

Answers at `/api/model-defaults/:id`, `/api/v1/model-defaults/:id`; also, undocumented, `/api/model-defaults/2026-08-07/:id`, `/api/v1/model-defaults/2026-08-07/:id`, `/api/model-defaults/latest/:id`, `/api/v1/model-defaults/latest/:id`.

```typescript
type Params = z.infer<typeof modelDefaultsRestParamsSchema>; // ../contract/src/model-provider-rest.schemas.ts:62
// Response: inline, src/transport/model-defaults.rest.ts:159
type Response = unknown;
```

### `modelProviderRest`

|             |                                                        |
| ----------- | ------------------------------------------------------ |
| Declared at | `src/transport/model-provider.rest.ts:29`              |
| Base URL    | `/api/model-providers`, twin `/api/v1/model-providers` |
| Addressing  | dated                                                  |
| Credential  | project                                                |
| Versions    | `2026-08-07`                                           |

#### `GET /` · `getApiModelProviders`

List all model providers for a project with masked API keys

Permission `project:view`. Declared at `src/transport/model-provider.rest.ts:34`.

Answers at `/api/model-providers`, `/api/v1/model-providers`; also, undocumented, `/api/model-providers/2026-08-07`, `/api/v1/model-providers/2026-08-07`, `/api/model-providers/latest`, `/api/v1/model-providers/latest`.

```typescript
type Response = z.infer<typeof apiResponseModelProvidersSchema>; // ../contract/src/model-provider-rest.schemas.ts:51
```

#### `PUT /:provider` · `putApiModelProvidersByProvider`

Create or update a model provider

Permission `project:update`. Declared at `src/transport/model-provider.rest.ts:49`.

Answers at `/api/model-providers/:provider`, `/api/v1/model-providers/:provider`; also, undocumented, `/api/model-providers/2026-08-07/:provider`, `/api/v1/model-providers/2026-08-07/:provider`, `/api/model-providers/latest/:provider`, `/api/v1/model-providers/latest/:provider`.

```typescript
// Params: modelProviderRestParamsSchema, ../contract/src/model-provider-rest.schemas.ts:15
interface Params {
  provider: string;
}
type Body = z.infer<typeof updateModelProviderInputSchema>; // ../contract/src/model-provider-rest.schemas.ts:17
type Response = z.infer<typeof apiResponseModelProvidersSchema>; // ../contract/src/model-provider-rest.schemas.ts:51
```

### `playgroundRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/playground.rest.ts:12`  |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | browser                                |

#### `POST /api/playground` · `runPlaygroundCompletion`

Permission `playground:view`. Declared at `src/transport/playground.rest.ts:18`.

Answers at `/api/playground`, `/api/v1/playground`.

```typescript
// Body: playgroundRestBodySchema, ../contract/src/model-provider-rest.schemas.ts:139
interface Body {
  messages: unknown[];
}
type Headers = z.infer<typeof playgroundRestHeadersSchema>; // ../contract/src/model-provider-rest.schemas.ts:144
// Response: inline, src/transport/playground.rest.ts:26
type Response = unknown;
```

## tRPC transport

### `llmModelCost`

Contract `../contract/src/llm-model-cost.trpc.ts:19`, router `src/transport/llm-model-cost.trpc.ts:25`.

| Procedure                           | Kind     | Gate                                                                                                                                                                                                   | Input                                 | Output                               |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------- | ------------------------------------ |
| `llmModelCost.getAllForProject`     | query    | Permission `project:view`                                                                                                                                                                              | `modelCostProjectTrpcInputSchema`     | inline                               |
| `llmModelCost.createOrUpdate`       | mutation | Service-authorized: COST_WRITE_PERMISSIONS; manage is asked on the written scope (default this project), known only after parsing; that scope resolves to the one organization the cost is anchored to | `modelCostWriteTrpcInputSchema`       | `modelCostSchema`                    |
| `llmModelCost.delete`               | mutation | Service-authorized: COST_WRITE_PERMISSIONS; the scope is the stored row's, never the caller's projectId; manage is asked on it                                                                         | `modelCostDeleteTrpcInputSchema`      | –                                    |
| `llmModelCost.getModelLimits`       | query    | Permission `project:view`                                                                                                                                                                              | `modelCostModelLimitsTrpcInputSchema` | inline                               |
| `llmModelCost.previewMatchingSpans` | query    | Permission `traces:view`                                                                                                                                                                               | `modelCostPreviewTrpcInputSchema`     | `costRuleMatchingSpansPreviewSchema` |

```typescript
// llmModelCost.getAllForProject
// Input: modelCostProjectTrpcInputSchema, ../contract/src/model-cost.trpc-schemas.ts:19
interface Input {
  projectId: string;
}
// Output: z.array(modelCostListRowSchema) (inline, ../contract/src/llm-model-cost.trpc.ts:22)

// llmModelCost.createOrUpdate
type Input = z.infer<typeof modelCostWriteTrpcInputSchema>; // ../contract/src/model-cost.trpc-schemas.ts:105
type Output = z.infer<typeof modelCostSchema>; // ../contract/src/model-provider.ts:473

// llmModelCost.delete
// Input: modelCostDeleteTrpcInputSchema, ../contract/src/model-cost.trpc-schemas.ts:23
interface Input {
  projectId: string;
  id: string;
}

// llmModelCost.getModelLimits
// Input: modelCostModelLimitsTrpcInputSchema, ../contract/src/model-cost.trpc-schemas.ts:28
interface Input {
  projectId: string;
  model: string;
}
// Output: inline, ../contract/src/llm-model-cost.trpc.ts:34
type Output = {
  maxInputTokens?: number;
  maxOutputTokens?: number;
  maxTokens?: number;
} | null;

// llmModelCost.previewMatchingSpans
// Input: modelCostPreviewTrpcInputSchema, ../contract/src/model-cost.trpc-schemas.ts:109
interface Input {
  projectId: string;
  model?: string;
  regex: string;
  inputCostPerToken?: number;
  outputCostPerToken?: number;
  cacheReadCostPerToken?: number;
  cacheCreationCostPerToken?: number;
  cacheCreation1hCostPerToken?: number;
}
type Output = z.infer<typeof costRuleMatchingSpansPreviewSchema>; // ../contract/src/model-cost-preview.ts:42
```

### `modelProvider`

Contract `../contract/src/model-provider.trpc.ts:43`, router `src/transport/model-provider.trpc.ts:46`.

| Procedure                                         | Kind     | Gate                                                                                                                                                                                                                                                                   | Input                                                  | Output                                    |
| ------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| `modelProvider.getAllForProject`                  | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelProviderProjectTrpcInputSchema`                  | `modelProviderListEntryMapTrpcSchema`     |
| `modelProvider.getAllForProjectForFrontend`       | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelProviderProjectTrpcInputSchema`                  | `modelProviderListEntryMapTrpcSchema`     |
| `modelProvider.listAllForProjectForFrontend`      | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelProviderProjectTrpcInputSchema`                  | inline                                    |
| `modelProvider.listAllForOrganizationForFrontend` | query    | Permission `organization:view`                                                                                                                                                                                                                                         | `modelProviderOrganizationTrpcInputSchema`             | inline                                    |
| `modelProvider.update`                            | mutation | Service-authorized: PROVIDER_WRITE_PERMISSIONS; the tenant anchor is data: a project when one is named, otherwise the organization the provider belongs to, and the application's per-scope assertCanWrite is what checks it                                           | `modelProviderUpdateTrpcInputSchema`                   | `modelProviderListEntrySchema`            |
| `modelProvider.delete`                            | mutation | Service-authorized: PROVIDER_WRITE_PERMISSIONS; the tenant anchor is data: a project when one is named, otherwise the organization the provider belongs to, and the application's per-scope assertCanWrite is what checks it                                           | `modelProviderDeleteTrpcInputSchema`                   | –                                         |
| `modelProvider.validateApiKey`                    | mutation | Service-authorized: project:update, organization:manage; the credential probe leaves this process for the vendor with caller-supplied keys, so the application checks the caller may write the tenant they named BEFORE probing; that check is the whole authorization | `modelProviderValidateApiKeyTrpcInputSchema`           | `modelProviderCredentialVerdictSchema`    |
| `modelProvider.testConnection`                    | mutation | Service-authorized: PROVIDER_WRITE_PERMISSIONS; the tenant anchor is data: a project when one is named, otherwise the organization the provider belongs to, and the application's per-scope assertCanWrite is what checks it                                           | `modelProviderTestConnectionTrpcInputSchema`           | `modelProviderCredentialVerdictSchema`    |
| `modelProvider.codexSignInStart`                  | mutation | Permission `project:update`                                                                                                                                                                                                                                            | `modelProviderProjectTrpcInputSchema`                  | `modelProviderCodexSignInStartSchema`     |
| `modelProvider.codexSignInPoll`                   | mutation | Permission `project:update`                                                                                                                                                                                                                                            | `modelProviderCodexSignInPollTrpcInputSchema`          | `modelProviderCodexSignInPollSchema`      |
| `modelProvider.codexApplyCodingDefaults`          | mutation | Permission `project:update`                                                                                                                                                                                                                                            | `modelProviderCodexApplyCodingDefaultsTrpcInputSchema` | `modelProviderCodexDefaultsAppliedSchema` |
| `modelProvider.codexStatus`                       | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelProviderProjectTrpcInputSchema`                  | `modelProviderCodexStatusSchema`          |
| `modelProvider.isManagedProvider`                 | query    | Permission `organization:view`                                                                                                                                                                                                                                         | `modelProviderIsManagedTrpcInputSchema`                | `modelProviderIsManagedSchema`            |
| `modelProvider.validateKeyWithCustomUrl`          | query    | Permission `project:update`                                                                                                                                                                                                                                            | `modelProviderValidateKeyWithCustomUrlTrpcInputSchema` | `modelProviderCredentialVerdictSchema`    |
| `modelProvider.getResolvedDefault`                | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelDefaultResolvedTrpcInputSchema`                  | inline                                    |
| `modelProvider.getDefaultModelsForProject`        | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelProviderProjectTrpcInputSchema`                  | `modelDefaultSnapshotSchema`              |
| `modelProvider.setRoleAssignmentForScope`         | mutation | Service-authorized: DEFAULT_WRITE_PERMISSIONS; the tier is data: the scope the caller names decides the permission, and the application's assertCanWriteDefault is what checks it                                                                                      | `modelDefaultRoleAssignmentTrpcInputSchema`            | `modelProviderOkAckSchema`                |
| `modelProvider.setFeatureOverrideForScope`        | mutation | Service-authorized: DEFAULT_WRITE_PERMISSIONS; the tier is data: the scope the caller names decides the permission, and the application's assertCanWriteDefault is what checks it                                                                                      | `modelDefaultFeatureOverrideTrpcInputSchema`           | `modelProviderOkAckSchema`                |
| `modelProvider.saveDefaultModelsConfig`           | mutation | Service-authorized: DEFAULT_WRITE_PERMISSIONS; the tier is data: the scope the caller names decides the permission, and the application's assertCanWriteDefault is what checks it                                                                                      | `modelDefaultConfigSaveTrpcInputSchema`                | `modelDefaultConfigSavedSchema`           |
| `modelProvider.deleteDefaultModelsConfig`         | mutation | Service-authorized: DEFAULT_WRITE_PERMISSIONS; the scopes are the stored row's, not the caller's input, so only the application can know which permissions to require                                                                                                  | `modelDefaultConfigDeleteTrpcInputSchema`              | `modelProviderOkAckSchema`                |
| `modelProvider.getInheritedValuesForScopes`       | query    | Permission `project:view`                                                                                                                                                                                                                                              | `modelDefaultInheritedValuesTrpcInputSchema`           | `modelDefaultInheritedValuesSchema`       |

```typescript
// modelProvider.getAllForProject
// Input: modelProviderProjectTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:56
interface Input {
  projectId: string;
}
type Output = z.infer<typeof modelProviderListEntryMapTrpcSchema>; // ../contract/src/model-provider.trpc-schemas.ts:233

// modelProvider.getAllForProjectForFrontend
type Input = z.infer<typeof modelProviderProjectTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:56
type Output = z.infer<typeof modelProviderListEntryMapTrpcSchema>; // ../contract/src/model-provider.trpc-schemas.ts:233

// modelProvider.listAllForProjectForFrontend
type Input = z.infer<typeof modelProviderProjectTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:56
// Output: z.array(modelProviderListEntrySchema) (inline, ../contract/src/model-provider.trpc.ts:57)

// modelProvider.listAllForOrganizationForFrontend
// Input: modelProviderOrganizationTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:59
interface Input {
  organizationId: string;
}
// Output: z.array(modelProviderListEntrySchema) (inline, ../contract/src/model-provider.trpc.ts:62)

// modelProvider.update
type Input = z.infer<typeof modelProviderUpdateTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:63
type Output = z.infer<typeof modelProviderListEntrySchema>; // ../contract/src/model-provider-list-entry.ts:12

// modelProvider.delete
// Input: modelProviderDeleteTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:123
interface Input {
  id?: string;
  projectId?: string;
  organizationId?: string;
  provider: string;
}

// modelProvider.validateApiKey
// Input: modelProviderValidateApiKeyTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:131
interface Input {
  projectId?: string;
  organizationId?: string;
  provider: string;
  customKeys: Record<string, string>;
  scopes?: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
type Output = z.infer<typeof modelProviderCredentialVerdictSchema>; // ../contract/src/model-provider.ts:235

// modelProvider.testConnection
// Input: modelProviderTestConnectionTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:149
interface Input {
  projectId?: string;
  organizationId?: string;
  actorId?: string;
  modelProviderId: string;
}
type Output = z.infer<typeof modelProviderCredentialVerdictSchema>; // ../contract/src/model-provider.ts:235

// modelProvider.codexSignInStart
type Input = z.infer<typeof modelProviderProjectTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:56
// Output: modelProviderCodexSignInStartSchema, ../contract/src/model-provider.trpc-schemas.ts:239
interface Output {
  userCode: string;
  deviceAuthId: string;
  verificationUrl: string;
  intervalSeconds: number;
}

// modelProvider.codexSignInPoll
// Input: modelProviderCodexSignInPollTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:151
interface Input {
  projectId: string;
  deviceAuthId: string;
  userCode: string;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
  setAsCodingDefaults?: boolean;
}
// Output: modelProviderCodexSignInPollSchema, ../contract/src/model-provider.trpc-schemas.ts:252
type Output =
  | {
      status: "pending";
    }
  | {
      status: "complete";
      providerId?: string;
      email: string;
      plan: string;
    };

// modelProvider.codexApplyCodingDefaults
// Input: modelProviderCodexApplyCodingDefaultsTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:161
interface Input {
  projectId: string;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
// Output: modelProviderCodexDefaultsAppliedSchema, ../contract/src/model-provider.trpc-schemas.ts:268
interface Output {
  applied: true;
}

// modelProvider.codexStatus
type Input = z.infer<typeof modelProviderProjectTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:56
// Output: modelProviderCodexStatusSchema, ../contract/src/model-provider.ts:261
type Output =
  | {
      connected: false;
    }
  | {
      connected: true;
      providerId: string;
      plan: string;
    };

// modelProvider.isManagedProvider
// Input: modelProviderIsManagedTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:166
interface Input {
  organizationId: string;
  provider: string;
}
// Output: modelProviderIsManagedSchema, ../contract/src/model-provider.trpc-schemas.ts:273
interface Output {
  managed: boolean;
}

// modelProvider.validateKeyWithCustomUrl
// Input: modelProviderValidateKeyWithCustomUrlTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:171
interface Input {
  projectId: string;
  provider: string;
  customBaseUrl?: string;
}
type Output = z.infer<typeof modelProviderCredentialVerdictSchema>; // ../contract/src/model-provider.ts:235

// modelProvider.getResolvedDefault
// Input: modelDefaultResolvedTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:187
interface Input {
  projectId: string;
  featureKey: string;
}
// Output: inline, ../contract/src/model-provider.trpc.ts:114
type Output = {
  model: string;
  source: "feature_override" | "role_default" | "inferred";
  scope: "project" | "team" | "organization" | null;
  inferredFromProvider?: string;
} | null;

// modelProvider.getDefaultModelsForProject
type Input = z.infer<typeof modelProviderProjectTrpcInputSchema>; // ../contract/src/model-provider.trpc-schemas.ts:56
type Output = z.infer<typeof modelDefaultSnapshotSchema>; // ../contract/src/model-provider.ts:375

// modelProvider.setRoleAssignmentForScope
// Input: modelDefaultRoleAssignmentTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:192
interface Input {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  role: "DEFAULT" | "FAST" | "LANGY" | "EMBEDDINGS";
  model: string | null;
}
// Output: modelProviderOkAckSchema, ../contract/src/model-provider.trpc-schemas.ts:265
interface Output {
  ok: true;
}

// modelProvider.setFeatureOverrideForScope
// Input: modelDefaultFeatureOverrideTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:199
interface Input {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  scopeId: string;
  featureKey: string;
  model: string | null;
}
type Output = z.infer<typeof modelProviderOkAckSchema>; // ../contract/src/model-provider.trpc-schemas.ts:265

// modelProvider.saveDefaultModelsConfig
// Input: modelDefaultConfigSaveTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:206
interface Input {
  id?: string;
  config: Record<string, string>;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
}
// Output: modelDefaultConfigSavedSchema, ../contract/src/model-provider.trpc-schemas.ts:276
interface Output {
  id: string;
}

// modelProvider.deleteDefaultModelsConfig
// Input: modelDefaultConfigDeleteTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:212
interface Input {
  id: string;
}
type Output = z.infer<typeof modelProviderOkAckSchema>; // ../contract/src/model-provider.trpc-schemas.ts:265

// modelProvider.getInheritedValuesForScopes
// Input: modelDefaultInheritedValuesTrpcInputSchema, ../contract/src/model-provider.trpc-schemas.ts:214
interface Input {
  projectId: string;
  scopes: {
    scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
    scopeId: string;
  }[];
  excludeConfigId?: string;
}
type Output = z.infer<typeof modelDefaultInheritedValuesSchema>; // ../contract/src/model-provider.ts:465
```

### `translate`

Contract `../contract/src/translate.trpc.ts:22`, router `src/transport/translate.trpc.ts:10`.

| Procedure             | Kind     | Gate                     | Input                      | Output                      |
| --------------------- | -------- | ------------------------ | -------------------------- | --------------------------- |
| `translate.translate` | mutation | Permission `traces:view` | `translateTextInputSchema` | `translateTextOutputSchema` |

```typescript
// translate.translate
// Input: translateTextInputSchema, ../contract/src/translate.trpc.ts:15
interface Input {
  projectId: string;
  textToTranslate: string;
}
// Output: translateTextOutputSchema, ../contract/src/translate.trpc.ts:20
interface Output {
  translation: string;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Tasks

Run by the tasks process, before serve.

| Task                                   | Class                                  | Declared at                                                 |
| -------------------------------------- | -------------------------------------- | ----------------------------------------------------------- |
| `model-registry-sync`                  | `ModelRegistrySyncTask`                | `src/tasks/model-registry-sync.task.ts:358`                 |
| `model-provider-migrate-custom-models` | `ModelProviderCustomModelsMigrateTask` | `src/tasks/model-provider-custom-models-migrate.task.ts:62` |

## Configuration

| Kind   | Leaf                                         | Environment variable                           | Declared at                                   |
| ------ | -------------------------------------------- | ---------------------------------------------- | --------------------------------------------- |
| secret | `...ModelProviderModule.platformCredentials` | ≈ `...ModelProviderModule.platformCredentials` | `src/app/model-provider.app.ts:248`           |
| secret | `...ModelProviderModule.operationalSecrets`  | ≈ `...ModelProviderModule.operationalSecrets`  | `src/app/model-provider.app.ts:249`           |
| config | `blockLocalHttpCalls`                        | `BLOCK_LOCAL_HTTP_CALLS`                       | `../contract/src/model-provider.config.ts:20` |
| config | `allowedProxyHosts`                          | `ALLOWED_PROXY_HOSTS`                          | `../contract/src/model-provider.config.ts:21` |
| config | `defaultModel`                               | `LANGWATCH_DEFAULT_MODEL`                      | `../contract/src/model-provider.config.ts:22` |
| config | `nlpServiceUrl`                              | `LANGWATCH_NLP_SERVICE`                        | `../contract/src/model-provider.config.ts:23` |
| config | `gatewayInternalUrl`                         | `LW_GATEWAY_INTERNAL_URL`                      | `../contract/src/model-provider.config.ts:24` |
| config | `gatewayPublicUrl`                           | `LW_GATEWAY_PUBLIC_URL`                        | `../contract/src/model-provider.config.ts:25` |
| config | `gatewayLegacyUrl`                           | `LW_GATEWAY_BASE_URL`                          | `../contract/src/model-provider.config.ts:26` |
| config | `probeBaseUrls.gemini`                       | `GEMINI_BASE_URL`                              | `../contract/src/model-provider.config.ts:32` |
| config | `probeBaseUrls.deepseek`                     | `DEEPSEEK_BASE_URL`                            | `../contract/src/model-provider.config.ts:33` |
| config | `probeBaseUrls.xai`                          | `XAI_BASE_URL`                                 | `../contract/src/model-provider.config.ts:34` |
| config | `probeBaseUrls.cerebras`                     | `CEREBRAS_BASE_URL`                            | `../contract/src/model-provider.config.ts:35` |
| config | `probeBaseUrls.groq`                         | `GROQ_BASE_URL`                                | `../contract/src/model-provider.config.ts:36` |
| config | `probeBaseUrls.elevenlabs`                   | `ELEVENLABS_BASE_URL`                          | `../contract/src/model-provider.config.ts:37` |

<!-- readme:generated:end -->
