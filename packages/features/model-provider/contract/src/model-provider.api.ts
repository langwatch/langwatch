import { featureApi } from "@langwatch/runtime-composition";
import type {
  Model,
  ModelCost,
  ModelCostEstimateInput,
  ModelCostListInput,
  ModelDefaultApiKeyScopeCheck,
  ModelDefaultConfig,
  ModelDefaultEffective,
  ModelDefaultInheritedValues,
  ModelDefaultResolveInput,
  ModelDefaultScope,
  ModelDefaultSnapshot,
  ModelProvider,
  ModelProviderAlternateResolution,
  ModelProviderApiKeyValidation,
  ModelProviderApiKeyValidationInput,
  ModelProviderCodexGatewayRefresh,
  ModelProviderCodexGatewayRefreshInput,
  ModelProviderCodexStatus,
  ModelProviderCodexStatusInput,
  ModelProviderCredentialVerdict,
  ModelProviderExecution,
  ModelProviderExecutionParameters,
  ModelProviderExecutionPrepareInput,
  ModelProviderListOrganizationInput,
  ModelProviderListProjectInput,
  ModelProviderResolution,
  ModelProviderSummary,
  TranslateInput,
  TranslateOutput,
} from "./model-provider.ts";

export interface ModelProviderCaller {
  readonly id: string;
}

export interface ModelProviderWriteRequest {
  readonly id?: string;
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly provider: string;
  readonly name?: string;
  readonly enabled: boolean;
  readonly defaultModel?: string;
  readonly customKeys?: Record<string, unknown> | null;
  readonly customModels?: Model[] | null;
  readonly customEmbeddingsModels?: Model[] | null;
  readonly extraHeaders?: Array<{ key: string; value: string }> | null;
  readonly routingHandle?: string | null;
  readonly langySkipPermissionsModels?: string[] | null;
  readonly scopes?: ModelDefaultScope[];
  readonly rateLimitRpm?: number | null;
  readonly rateLimitTpm?: number | null;
  readonly rateLimitRpd?: number | null;
  readonly fallbackPriorityGlobal?: number | null;
  readonly providerConfig?: Record<string, unknown> | null;
}

export interface ModelProviderDeleteRequest {
  readonly id?: string;
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly provider: string;
}

export interface ModelProviderTestConnectionRequest {
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly modelProviderId: string;
}

export interface ModelDefaultSnapshotRequest {
  readonly projectId: string;
}
export interface ModelDefaultAssignmentRequest {
  readonly scope: ModelDefaultScope;
  readonly key: string;
  readonly model: string | null;
}
export interface ModelDefaultConfigWriteRequest {
  readonly id?: string;
  readonly config?: Record<string, string>;
  readonly scopes?: ModelDefaultScope[];
}
export interface ModelDefaultDeleteRequest {
  readonly id: string;
}
export interface ModelCostWriteRequest {
  readonly id?: string;
  readonly projectId: string;
  readonly scopeType?: "ORGANIZATION" | "TEAM" | "PROJECT";
  readonly scopeId?: string;
  readonly model: string;
  readonly regex: string;
  readonly inputCostPerToken?: number | null;
  readonly outputCostPerToken?: number | null;
  readonly cacheReadCostPerToken?: number | null;
  readonly cacheCreationCostPerToken?: number | null;
  readonly cacheCreation1hCostPerToken?: number | null;
}
export interface ModelCostDeleteRequest {
  readonly projectId: string;
  readonly id: string;
}
/** Callable model-provider operations shared by process peers after composition. */
export interface ModelProviderApi {
  estimateCost(input: ModelCostEstimateInput): number;
  listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]>;
  listForOrganization(input: ModelProviderListOrganizationInput): Promise<ModelProviderSummary[]>;
  getForProject(
    input: ModelProviderListProjectInput & { provider?: string },
  ): Promise<Record<string, ModelProviderSummary>>;
  tryGetProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null>;
  tryFindRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null>;
  getExecutionProviders(
    input: ModelProviderListProjectInput,
  ): Promise<Record<string, ModelProviderExecution>>;
  prepareExecution(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProviderExecutionParameters>;
  upsert(input: ModelProviderWriteRequest, by: ModelProviderCaller): Promise<ModelProvider>;
  delete(input: ModelProviderDeleteRequest, by: ModelProviderCaller): Promise<void>;
  validateApiKey(input: ModelProviderApiKeyValidationInput): Promise<ModelProviderApiKeyValidation>;
  testConnection(
    input: ModelProviderTestConnectionRequest,
    by: ModelProviderCaller,
  ): Promise<ModelProviderCredentialVerdict>;
  getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus>;
  refreshCodexForGateway(
    input: ModelProviderCodexGatewayRefreshInput,
  ): Promise<ModelProviderCodexGatewayRefresh>;
  isManagedProvider(input: { organizationId: string; provider: string }): boolean;
  getDefaultSnapshot(
    input: ModelDefaultSnapshotRequest,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultSnapshot>;
  getInheritedValues(input: {
    projectId: string;
    scopes: ModelDefaultScope[];
    excludeConfigId?: string;
  }): Promise<ModelDefaultInheritedValues>;
  tryGetResolvedDefault(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null>;
  resolveModelForFeature(input: ModelDefaultResolveInput): Promise<ModelProviderResolution>;
  findAlternateModel(input: {
    projectId: string;
    featureKey: string;
    skipFromScope: ModelProviderResolution["scope"];
  }): Promise<ModelProviderAlternateResolution>;
  setDefault(input: ModelDefaultAssignmentRequest, by: ModelProviderCaller): Promise<void>;
  saveDefaultConfig(
    input: ModelDefaultConfigWriteRequest,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultConfig>;
  assertApiKeyMayWriteDefaultScopes(input: ModelDefaultApiKeyScopeCheck): Promise<void>;
  tryGetDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null>;
  deleteDefaultConfig(input: ModelDefaultDeleteRequest, by: ModelProviderCaller): Promise<void>;
  listCosts(input: ModelCostListInput): Promise<ModelCost[]>;
  upsertCost(input: ModelCostWriteRequest, by: ModelProviderCaller): Promise<ModelCost>;
  deleteCost(input: ModelCostDeleteRequest, by: ModelProviderCaller): Promise<void>;
  translate(input: TranslateInput): Promise<TranslateOutput>;
  applyCodexCodingDefaults(
    input: { scopes: readonly ModelDefaultScope[] },
    by: ModelProviderCaller,
  ): Promise<void>;
}

export const ModelProviderApi = featureApi<ModelProviderApi>("model-provider");
