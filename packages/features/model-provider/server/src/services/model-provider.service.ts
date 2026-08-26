import {
  ModelProviderInvalidError,
  translateInputSchema,
  type ModelCost,
  type ModelCostDeleteInput,
  type ModelCostEstimateInput,
  type ModelCostWriteInput,
  type ModelDefaultAssignmentInput,
  type ModelDefaultConfig,
  type ModelDefaultConfigWriteInput,
  type ModelDefaultDeleteInput,
  type ModelDefaultEffective,
  type ModelDefaultInheritedValues,
  type ModelDefaultResolveInput,
  type ModelDefaultScope,
  type ModelDefaultSnapshot,
  type ModelDefaultSnapshotInput,
  type ModelProvider,
  type ModelProviderApiKeyValidation,
  type ModelProviderApiKeyValidationInput,
  type ModelProviderCodexGatewayRefresh,
  type ModelProviderCodexStatus,
  type ModelProviderCodexStatusInput,
  type ModelProviderDeleteInput,
  type ModelProviderExecution,
  type ModelProviderExecutionParameters,
  type ModelProviderExecutionPrepareInput,
  ModelProviderService as ModelProviderServiceContract,
  type ModelProviderSummary,
  type ModelProviderTestConnectionInput,
  type ModelProviderWriteInput,
  type TranslateInput,
  type TranslateOutput,
} from "@langwatch/model-provider-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type {
  CodexTokenRefresher,
  ModelCostRepository,
  ModelDefaultRepository,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialPolicy,
  ModelProviderIdService,
  ModelProviderRepository,
  ModelTranslationPort,
} from "../ports/model-provider.port";
import { ModelProviderCommandService } from "./model-provider-command.service";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service";
import { ModelProviderCodexService } from "./model-provider-codex.service";
import { ModelProviderCostsService } from "./model-provider-costs.service";
import { ModelProviderDefaultsService } from "./model-provider-defaults.service";
import { ModelProviderDefaultsWriteService } from "./model-provider-defaults-write.service";
import { ModelProviderExecutionService } from "./model-provider-execution.service";
import { ModelProviderOnboardingDefaultsService } from "./model-provider-onboarding-defaults.service";
import { ModelProviderQueryService } from "./model-provider-query.service";
import { ModelProviderWriteAuthorizationService } from "./model-provider-write-authorization.service";
import { ModelProviderScopeService } from "./model-provider-scope.service";

export interface ModelProviderServiceOptions {
  repository: ModelProviderRepository;
  projects: ProjectService;
  organizations: OrganizationService;
  credentialPolicy: ModelProviderCredentialPolicy;
  codexTokenRefresher: CodexTokenRefresher;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
  defaults: ModelDefaultRepository;
  costs: ModelCostRepository;
  catalog: ModelProviderCatalog;
  authorization: AuthzService;
  translation: ModelTranslationPort;
  ids: ModelProviderIdService;
}

/**
 * The canonical contract delegates coherent read, write, defaults, and costs
 * lifecycles to private collaborators in this feature.
 */
export class ModelProviderService extends ModelProviderServiceContract {
  private readonly commands: ModelProviderCommandService;
  private readonly codex: ModelProviderCodexService;
  private readonly costs: ModelProviderCostsService;
  private readonly defaults: ModelProviderDefaultsService;
  private readonly defaultWrites: ModelProviderDefaultsWriteService;
  private readonly execution: ModelProviderExecutionService;
  private readonly query: ModelProviderQueryService;

  private constructor(private readonly options: ModelProviderServiceOptions) {
    super();

    const writeAuthorization = ModelProviderWriteAuthorizationService.create(
      options.authorization,
    );
    const authorization = ModelProviderAuthorizationService.create(options.authorization);
    const scopes = ModelProviderScopeService.create({
      projects: options.projects,
      organizations: options.organizations,
    });
    this.commands = ModelProviderCommandService.create({
      repository: options.repository,
      defaults: options.defaults,
      credentialPolicy: options.credentialPolicy,
      catalog: options.catalog,
      connectionRateLimiter: options.connectionRateLimiter,
      writeAuthorization,
      onboardingDefaults: ModelProviderOnboardingDefaultsService.create({
        defaults: options.defaults,
        ids: options.ids,
        scopes,
      }),
      ids: options.ids,
      scopes,
    });
    this.costs = ModelProviderCostsService.create({
      costs: options.costs,
      catalog: options.catalog,
      authorization,
      ids: options.ids,
      scopes,
    });
    this.defaults = ModelProviderDefaultsService.create({
      defaults: options.defaults,
      providers: options.repository,
      catalog: options.catalog,
      authorization,
      scopes,
    });
    this.defaultWrites = ModelProviderDefaultsWriteService.create({
      defaults: options.defaults,
      catalog: options.catalog,
      writeAuthorization,
      ids: options.ids,
      scopes,
    });
    this.query = ModelProviderQueryService.create({
      repository: options.repository,
      scopes,
      credentialPolicy: options.credentialPolicy,
      catalog: options.catalog,
    });
    this.codex = ModelProviderCodexService.create({
      repository: options.repository,
      query: this.query,
      tokenRefresher: options.codexTokenRefresher,
    });
    this.execution = ModelProviderExecutionService.create({
      query: this.query,
      catalog: options.catalog,
    });
  }

  static create(options: ModelProviderServiceOptions): ModelProviderService {
    return new ModelProviderService(options);
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return this.costs.estimate(input);
  }

  listForProject(input: { projectId: string }): Promise<ModelProviderSummary[]> {
    return this.query.listForProject(input);
  }

  listForOrganization(input: {
    organizationId: string;
  }): Promise<ModelProviderSummary[]> {
    return this.query.listForOrganization(input);
  }

  getForProject(input: {
    projectId: string;
    provider?: string;
  }): Promise<Record<string, ModelProviderSummary>> {
    return this.query.getForProject(input);
  }

  tryGetProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null> {
    return this.query.tryGetProviderForProject(input);
  }

  tryFindRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null> {
    return this.query.tryFindRowServingModel(input);
  }

  getExecutionProviders(input: {
    projectId: string;
  }): Promise<Record<string, ModelProviderExecution>> {
    return this.query.getExecutionProviders(input);
  }

  prepareExecution(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProviderExecutionParameters> {
    return this.execution.prepare(input);
  }

  upsert(input: ModelProviderWriteInput): Promise<ModelProvider> {
    return this.commands.upsert(input);
  }

  delete(input: ModelProviderDeleteInput): Promise<void> {
    return this.commands.delete(input);
  }

  validateApiKey(
    input: ModelProviderApiKeyValidationInput,
  ): Promise<ModelProviderApiKeyValidation> {
    return this.commands.validateApiKey(input);
  }

  testConnection(
    input: ModelProviderTestConnectionInput,
  ): Promise<{ connected: boolean }> {
    return this.commands.testConnection(input);
  }

  getCodexStatus(
    input: ModelProviderCodexStatusInput,
  ): Promise<ModelProviderCodexStatus> {
    return this.codex.getStatus(input);
  }

  refreshCodexForGateway(input: {
    providerRowId: string;
  }): Promise<ModelProviderCodexGatewayRefresh> {
    return this.codex.refreshForGateway(input);
  }

  isManagedProvider(input: { organizationId: string; provider: string }): boolean {
    return this.options.catalog.isManagedProvider(input.organizationId, input.provider);
  }

  getDefaultSnapshot(input: ModelDefaultSnapshotInput): Promise<ModelDefaultSnapshot> {
    return this.defaults.getSnapshot(input);
  }

  getInheritedValues(input: {
    projectId: string;
    scopes: ModelDefaultScope[];
    excludeConfigId?: string;
  }): Promise<ModelDefaultInheritedValues> {
    return this.defaults.getInheritedValues(input);
  }

  tryGetResolvedDefault(
    input: ModelDefaultResolveInput,
  ): Promise<ModelDefaultEffective | null> {
    return this.defaults.tryGetResolved(input);
  }

  setDefault(input: ModelDefaultAssignmentInput): Promise<void> {
    return this.defaultWrites.set(input);
  }

  saveDefaultConfig(input: ModelDefaultConfigWriteInput): Promise<ModelDefaultConfig> {
    return this.defaultWrites.save(input);
  }

  tryGetDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null> {
    return this.defaultWrites.tryGet(input);
  }

  deleteDefaultConfig(input: ModelDefaultDeleteInput): Promise<void> {
    return this.defaultWrites.delete(input);
  }

  listCosts(input: { projectId: string }): Promise<ModelCost[]> {
    return this.costs.list(input);
  }

  upsertCost(input: ModelCostWriteInput): Promise<ModelCost> {
    return this.costs.upsert(input);
  }

  deleteCost(input: ModelCostDeleteInput): Promise<void> {
    return this.costs.delete(input);
  }

  async translate(input: TranslateInput): Promise<TranslateOutput> {
    const parsed = translateInputSchema.parse(input);
    const resolved = await this.defaults.tryGetResolved({
      projectId: parsed.projectId,
      featureKey: "translate.text",
    });
    if (!resolved) {
      throw new ModelProviderInvalidError("No translation model is configured");
    }

    return {
      translation: await this.options.translation.translate({
        ...parsed,
        model: resolved.model,
        modelProviders: this,
      }),
    };
  }
}
