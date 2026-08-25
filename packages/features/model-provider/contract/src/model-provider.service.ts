import type {
  ModelCost, ModelCostDeleteInput, ModelCostEstimateInput, ModelCostListInput, ModelCostWriteInput,
  ModelDefaultAssignmentInput, ModelDefaultConfig, ModelDefaultConfigWriteInput, ModelDefaultDeleteInput,
  ModelDefaultInheritedValues, ModelDefaultResolveInput, ModelDefaultScope, ModelDefaultSnapshot, ModelDefaultSnapshotInput, ModelProvider, ModelProviderApiKeyValidation,
  ModelProviderApiKeyValidationInput, ModelProviderDeleteInput, ModelProviderListOrganizationInput,
  ModelProviderListProjectInput, ModelProviderSummary, ModelProviderTestConnectionInput,
  ModelProviderCodexStatus, ModelProviderCodexStatusInput,
  ModelProviderWriteInput, TranslateInput, TranslateOutput,
} from "./model-provider";

export abstract class ModelProviderService {
  abstract listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]>;
  abstract listForOrganization(input: ModelProviderListOrganizationInput): Promise<ModelProviderSummary[]>;
  abstract getForProject(input: ModelProviderListProjectInput & { provider?: string }): Promise<Record<string, ModelProviderSummary>>;
  abstract upsert(input: ModelProviderWriteInput): Promise<ModelProvider>;
  abstract delete(input: ModelProviderDeleteInput): Promise<void>;
  abstract validateApiKey(input: ModelProviderApiKeyValidationInput): Promise<ModelProviderApiKeyValidation>;
  abstract testConnection(input: ModelProviderTestConnectionInput): Promise<{ connected: boolean }>;
  abstract getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus>;
  abstract isManagedProvider(input: { organizationId: string; provider: string }): boolean;
  abstract getDefaultSnapshot(input: ModelDefaultSnapshotInput): Promise<ModelDefaultSnapshot>;
  abstract getInheritedValues(input: { projectId: string; scopes: ModelDefaultScope[]; excludeConfigId?: string }): Promise<ModelDefaultInheritedValues>;
  abstract tryGetResolvedDefault(input: ModelDefaultResolveInput): Promise<import("./model-provider").ModelDefaultEffective | null>;
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
