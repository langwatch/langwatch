import { moduleApi } from "@langwatch/runtime-composition";
import type { CodexTokenKeys } from "./codex-account.ts";
import type { CostRuleMatchingSpansPreview, ModelLimits } from "./model-cost-preview.ts";
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
/**
 * A credential the caller has just typed, probed before anything stores it.
 * The tenant is what the probe is authorized against: the project when one is
 * named, the organization otherwise.
 */
export interface ModelProviderCredentialProbeRequest {
  readonly projectId?: string;
  readonly organizationId?: string;
  readonly provider: string;
  readonly customKeys: Record<string, string>;
}
/** A credential that is already stored, probed against a base URL. */
export interface ModelProviderStoredCredentialProbeRequest {
  readonly projectId: string;
  readonly provider: string;
  readonly customBaseUrl?: string;
}
/** Codex step 1: the device code the browser shows, and how often to poll. */
export interface ModelProviderCodexDeviceSignIn {
  readonly userCode: string;
  readonly deviceAuthId: string;
  readonly verificationUrl: string;
  readonly intervalSeconds: number;
}
/** Codex step 2..n: one poll of the pending device authorization. */
export type ModelProviderCodexDeviceApproval =
  | Readonly<{ status: "pending" }>
  | Readonly<{ status: "complete"; keys: CodexTokenKeys }>;
/** The rule a customer is still typing, priced against the spans it matches. */
export interface ModelCostPreviewRequest {
  readonly projectId: string;
  readonly regex: string;
  readonly model?: string;
  readonly inputCostPerToken?: number;
  readonly outputCostPerToken?: number;
  readonly cacheReadCostPerToken?: number;
  readonly cacheCreationCostPerToken?: number;
  readonly cacheCreation1hCostPerToken?: number;
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
  /**
   * The write a project credential makes, which names no person to attribute
   * it to and no person to authorize it against: the key's own project
   * permission is the whole gate, as this door has always worked.
   */
  upsertUnattributed(input: ModelProviderWriteRequest): Promise<ModelProvider>;
  delete(input: ModelProviderDeleteRequest, by: ModelProviderCaller): Promise<void>;
  /**
   * Probes a credential the caller supplied, after checking they may write
   * the tenant they named. Nothing downstream re-authorizes this: the probe
   * goes straight out to the provider with those keys, so the check here IS
   * the authorization.
   */
  validateApiKey(
    input: ModelProviderCredentialProbeRequest,
    by: ModelProviderCaller,
  ): Promise<ModelProviderCredentialVerdict>;
  /** Probes the stored (or environment-fed) credential against a base URL. */
  validateStoredKey(
    input: ModelProviderStoredCredentialProbeRequest,
  ): Promise<ModelProviderCredentialVerdict>;
  startCodexDeviceSignIn(): Promise<ModelProviderCodexDeviceSignIn>;
  pollCodexDeviceSignIn(input: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<ModelProviderCodexDeviceApproval>;
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
  /**
   * The same snapshot read as nobody, for a project credential that names no
   * person. What a snapshot shows is filtered by what its reader may see, and
   * there is no reader here.
   */
  getDefaultSnapshotUnattributed(input: ModelDefaultSnapshotRequest): Promise<ModelDefaultSnapshot>;
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
  /** The registry's context-window and output ceilings, or null when it names no such model. */
  findModelLimits(input: { model: string }): ModelLimits | null;
  /** What a cost rule the caller is still typing would match, over the recent window. */
  previewCostRuleMatchingSpans(
    input: ModelCostPreviewRequest,
  ): Promise<CostRuleMatchingSpansPreview>;
  upsertCost(input: ModelCostWriteRequest, by: ModelProviderCaller): Promise<ModelCost>;
  deleteCost(input: ModelCostDeleteRequest, by: ModelProviderCaller): Promise<void>;
  translate(input: TranslateInput): Promise<TranslateOutput>;
  applyCodexCodingDefaults(
    input: { scopes: readonly ModelDefaultScope[] },
    by: ModelProviderCaller,
  ): Promise<void>;
}

export const ModelProviderApi = moduleApi<ModelProviderApi>("model-provider");
