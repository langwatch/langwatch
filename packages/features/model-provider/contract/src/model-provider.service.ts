import type {
  ModelCost,
  ModelCostDeleteInput,
  ModelCostEstimateInput,
  ModelCostListInput,
  ModelCostWriteInput,
  ModelDefaultAssignmentInput,
  ModelDefaultConfig,
  ModelDefaultConfigWriteInput,
  ModelDefaultDeleteInput,
  ModelDefaultInheritedValues,
  ModelDefaultResolveInput,
  ModelDefaultScope,
  ModelDefaultSnapshot,
  ModelDefaultSnapshotInput,
  ModelProvider,
  ModelProviderApiKeyValidation,
  ModelProviderApiKeyValidationInput,
  ModelProviderCredentialVerdict,
  ModelProviderDeleteInput,
  ModelProviderExecutionParameters,
  ModelProviderExecutionPrepareInput,
  ModelProviderExecution,
  ModelProviderListOrganizationInput,
  ModelProviderListProjectInput,
  ModelProviderSummary,
  ModelProviderTestConnectionInput,
  ModelProviderCodexStatus,
  ModelProviderCodexStatusInput,
  ModelProviderCodexGatewayRefresh,
  ModelProviderCodexGatewayRefreshInput,
  ModelProviderAlternateResolution,
  ModelProviderResolution,
  ModelProviderWriteInput,
  TranslateInput,
  TranslateOutput,
} from "./model-provider";

export abstract class ModelProviderService {
  abstract listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]>;
  abstract listForOrganization(
    input: ModelProviderListOrganizationInput,
  ): Promise<ModelProviderSummary[]>;
  abstract getForProject(
    input: ModelProviderListProjectInput & { provider?: string },
  ): Promise<Record<string, ModelProviderSummary>>;
  abstract tryGetProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null>;
  abstract tryFindRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null>;
  abstract getExecutionProviders(
    input: ModelProviderListProjectInput,
  ): Promise<Record<string, ModelProviderExecution>>;
  abstract prepareExecution(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProviderExecutionParameters>;
  abstract upsert(input: ModelProviderWriteInput): Promise<ModelProvider>;
  abstract delete(input: ModelProviderDeleteInput): Promise<void>;
  abstract validateApiKey(
    input: ModelProviderApiKeyValidationInput,
  ): Promise<ModelProviderApiKeyValidation>;
  /**
   * Probes a credential that is already stored.
   *
   * Returns the three-verdict union, not a boolean. Collapsing it here is what
   * broke Test Connection once already: "we could not check this" became
   * indistinguishable from "this works", and the browser had no shape left to
   * tell them apart.
   */
  abstract testConnection(
    input: ModelProviderTestConnectionInput,
  ): Promise<ModelProviderCredentialVerdict>;
  abstract getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus>;
  abstract refreshCodexForGateway(
    input: ModelProviderCodexGatewayRefreshInput,
  ): Promise<ModelProviderCodexGatewayRefresh>;
  abstract isManagedProvider(input: { organizationId: string; provider: string }): boolean;
  abstract getDefaultSnapshot(input: ModelDefaultSnapshotInput): Promise<ModelDefaultSnapshot>;
  abstract getInheritedValues(input: {
    projectId: string;
    scopes: ModelDefaultScope[];
    excludeConfigId?: string;
  }): Promise<ModelDefaultInheritedValues>;
  abstract tryGetResolvedDefault(
    input: ModelDefaultResolveInput,
  ): Promise<import("./model-provider").ModelDefaultEffective | null>;
  abstract resolveModelForFeature(
    input: ModelDefaultResolveInput,
  ): Promise<ModelProviderResolution>;
  abstract findAlternateModel(input: {
    projectId: string;
    featureKey: string;
    skipFromScope: ModelProviderResolution["scope"];
  }): Promise<ModelProviderAlternateResolution>;
  abstract setDefault(input: ModelDefaultAssignmentInput): Promise<void>;
  abstract saveDefaultConfig(input: ModelDefaultConfigWriteInput): Promise<ModelDefaultConfig>;
  abstract tryGetDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null>;
  abstract deleteDefaultConfig(input: ModelDefaultDeleteInput): Promise<void>;
  abstract listCosts(input: ModelCostListInput): Promise<ModelCost[]>;
  abstract upsertCost(input: ModelCostWriteInput): Promise<ModelCost>;
  abstract deleteCost(input: ModelCostDeleteInput): Promise<void>;
  /** Uses the catalog's canonical cost cascade; zero means no price was found. */
  abstract estimateCost(input: ModelCostEstimateInput): number;
  abstract translate(input: TranslateInput): Promise<TranslateOutput>;
}
