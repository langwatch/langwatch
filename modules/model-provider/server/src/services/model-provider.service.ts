import {
  ModelProviderInvalidError,
  translateInputSchema,
  type ModelCost,
  type ModelCostDeleteInput,
  type ModelCostEstimateInput,
  type ModelCostWriteInput,
  type ModelDefaultApiKeyScopeCheck,
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
  type ModelProviderCredentialVerdict,
  type ModelProviderApiKeyValidationInput,
  type ModelProviderCodexGatewayRefresh,
  type ModelProviderCodexStatus,
  type ModelProviderCodexStatusInput,
  type ModelProviderDeleteInput,
  type ModelProviderExecution,
  type ModelProviderAlternateResolution,
  type ModelProviderResolution,
  type ModelProviderExecutionParameters,
  type ModelProviderExecutionPrepareInput,
  type ModelProviderSummary,
  type ModelProviderTestConnectionInput,
  type ModelProviderWriteInput,
  type TranslateInput,
  type TranslateOutput,
} from "@langwatch/model-provider-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type {
  CodexTokenRefresher,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialPolicy,
  ModelProviderIdService,
  ModelTranslation
} from "../app/model-provider.members.ts";
import type {
  ModelCostRepository
} from "../repositories/model-cost.repository.ts";
import type {
  ModelDefaultRepository
} from "../repositories/model-default.repository.ts";
import type {
  ModelProviderRepository
} from "../repositories/model-provider.repository.ts";
import { ModelProviderCommandService } from "./model-provider-command.service.ts";
import { ModelProviderAuthorizationService } from "./model-provider-authorization.service.ts";
import { ModelProviderCodexService } from "./model-provider-codex.service.ts";
import { ModelProviderCostsService } from "./model-provider-costs.service.ts";
import { ModelProviderDefaultsService } from "./model-provider-defaults.service.ts";
import { ModelProviderDefaultsWriteService } from "./model-provider-defaults-write.service.ts";
import { ModelProviderExecutionService } from "./model-provider-execution.service.ts";
import { ModelProviderOnboardingDefaultsService } from "./model-provider-onboarding-defaults.service.ts";
import { ModelProviderQueryService } from "./model-provider-query.service.ts";
import { ModelProviderWriteAuthorizationService } from "./model-provider-write-authorization.service.ts";
import { ModelProviderScopeService } from "./model-provider-scope.service.ts";
import { ModelProviderResolutionService } from "./model-provider-resolution.service.ts";

export interface ModelProviderServiceOptions {
  repository: ModelProviderRepository;
  projects: ProjectApi;
  organizations: OrganizationApi;
  credentialPolicy: ModelProviderCredentialPolicy;
  codexTokenRefresher: CodexTokenRefresher;
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
  defaults: ModelDefaultRepository;
  costs: ModelCostRepository;
  catalog: ModelProviderCatalog;
  authorization: AuthzApi;
  translation: ModelTranslation;
  ids: ModelProviderIdService;
}

/**
 * The canonical contract delegates coherent read, write, defaults, and costs
 * lifecycles to private collaborators in this feature.
 */
export class ModelProviderService {
  private readonly commands: ModelProviderCommandService;
  private readonly codex: ModelProviderCodexService;
  private readonly costs: ModelProviderCostsService;
  private readonly defaults: ModelProviderDefaultsService;
  private readonly defaultWrites: ModelProviderDefaultsWriteService;
  private readonly execution: ModelProviderExecutionService;
  private readonly query: ModelProviderQueryService;
  private readonly resolution: ModelProviderResolutionService;
  private readonly writeAuthorization: ModelProviderWriteAuthorizationService;

  private constructor(private readonly options: ModelProviderServiceOptions) {
    const authorization = ModelProviderAuthorizationService.create(options.authorization);
    const writeAuthorization = ModelProviderWriteAuthorizationService.create(authorization);
    this.writeAuthorization = writeAuthorization;
    const scopes = ModelProviderScopeService.create({
      projects: options.projects,
      organizations: options.organizations,
    });
    this.resolution = ModelProviderResolutionService.create({
      defaults: options.defaults,
      catalog: options.catalog,
      scopes,
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

  listForOrganization(input: { organizationId: string }): Promise<ModelProviderSummary[]> {
    return this.query.listForOrganization(input);
  }

  getForProject(input: {
    projectId: string;
    provider?: string;
  }): Promise<Record<string, ModelProviderSummary>> {
    return this.query.getForProject(input);
  }

  findProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null> {
    return this.query.findProviderForProject(input);
  }

  findRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null> {
    return this.query.findRowServingModel(input);
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

  testConnection(input: ModelProviderTestConnectionInput): Promise<ModelProviderCredentialVerdict> {
    return this.commands.testConnection(input);
  }

  getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus> {
    return this.codex.getStatus(input);
  }

  refreshCodexForGateway(input: {
    providerRowId: string;
  }): Promise<ModelProviderCodexGatewayRefresh> {
    return this.codex.refreshForGateway(input);
  }

  isManagedProvider(input: { organizationId: string; provider: string }): boolean {
    return this.options.catalog.isManagedProvider(input);
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

  findResolvedDefault(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null> {
    return this.defaults.tryGetResolved(input);
  }

  resolveModelForFeature(input: ModelDefaultResolveInput): Promise<ModelProviderResolution> {
    return this.resolution.resolve(input);
  }

  findAlternateModel(input: {
    projectId: string;
    featureKey: string;
    skipFromScope: ModelProviderResolution["scope"];
  }): Promise<ModelProviderAlternateResolution> {
    return this.resolution.findAlternate(input);
  }

  setDefault(input: ModelDefaultAssignmentInput): Promise<void> {
    return this.defaultWrites.set(input);
  }

  saveDefaultConfig(input: ModelDefaultConfigWriteInput): Promise<ModelDefaultConfig> {
    return this.defaultWrites.save(input);
  }

  assertApiKeyMayWriteDefaultScopes(input: ModelDefaultApiKeyScopeCheck): Promise<void> {
    return this.writeAuthorization.assertApiKeyCanWriteDefault(input.apiKey, input.scopes);
  }

  findDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null> {
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
