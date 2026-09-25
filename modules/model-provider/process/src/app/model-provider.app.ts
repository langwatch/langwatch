import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { FeatureSetup } from "@langwatch/kernel";
/**
 * The model-provider feature's application: what `modelProvider.*`, `llmModelCost.*` and
 * `translate.*` all call, so caller attribution and Codex-role defaults are written once.
 */
import {
  CODEX_DEFAULT_MODEL,
  findFeatureByKey,
  ModelCostPreviewUnavailableError,
  ModelProviderAnchorRequiredError,
  ModelProviderApi,
  type ModelCostDeleteRequest,
  type ModelCostWriteRequest,
  type ModelDefaultAssignmentRequest,
  type ModelDefaultConfigWriteRequest,
  type ModelDefaultDeleteRequest,
  type ModelDefaultSnapshotRequest,
  type CostRuleMatchingSpansPreview,
  type ModelCostPreviewRequest,
  type ModelLimits,
  type ModelProviderCaller,
  type ModelProviderCodexDeviceApproval,
  type ModelProviderCodexDeviceSignIn,
  type ModelProviderCredentialProbeRequest,
  type ModelProviderStoredCredentialProbeRequest,
  type ModelProviderDeleteRequest,
  type ModelProviderTestConnectionRequest,
  type ModelProviderWriteRequest,
  type ModelCost,
  type ModelCostEstimateInput,
  type ModelCostListInput,
  type ModelDefaultApiKeyScopeCheck,
  type ModelDefaultConfig,
  type ModelDefaultEffective,
  type ModelDefaultInheritedValues,
  type ModelDefaultResolveInput,
  type ModelDefaultScope,
  type ModelDefaultSnapshot,
  type ModelProvider,
  type ModelProviderAlternateResolution,
  type ModelProviderCodexGatewayRefresh,
  type ModelProviderCodexGatewayRefreshInput,
  type ModelProviderCodexStatus,
  type ModelProviderCodexStatusInput,
  type ModelProviderCredentialVerdict,
  type ModelProviderExecution,
  type ModelProviderExecutionParameters,
  type ModelProviderExecutionPrepareInput,
  type ModelProviderStructuredGenerationInput,
  type ModelProviderPlaygroundCompletion,
  type ModelProviderPlaygroundRequest,
  type ModelProviderListOrganizationInput,
  type ModelProviderListProjectInput,
  type ModelProviderResolution,
  type ModelProviderSummary,
  type TranslateInput,
  type TranslateOutput,
  modelProviderConfig,
  type ModelProviderServerConfig,
  type PlatformProviderEntry,
  type ModelProviderUsageCount,
} from "@langwatch/model-provider-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { openAiApiKey, Secret } from "@langwatch/secrets";

import type { ModelProviderConnectionPing } from "../channels/model-provider-connection-ping.channel.ts";
import type { ModelProviderRepositories } from "../repositories/model-provider.repositories.ts";
import { AiCallFailureService } from "../services/ai-call-failure.service.ts";
import {
  ModelCostPreviewService,
  type ModelCostPreviewSpanReader,
} from "../services/model-cost-preview.service.ts";
import { ModelCostRegexSafetyService } from "../services/model-cost-regex-safety.service.ts";
import { ModelLimitsService } from "../services/model-limits.service.ts";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service.ts";
import { ModelProviderEvaluatorModelEnvService } from "../services/model-provider-evaluator-model-env.service.ts";
import { ModelProviderExecutionHandleService } from "../services/model-provider-execution-handle.service.ts";
import { ModelProviderKeysService } from "../services/model-provider-keys.service.ts";
import { ModelProviderPlaygroundService } from "../services/model-provider-playground.service.ts";
import { ModelProviderStructuredGenerationService } from "../services/model-provider-structured-generation.service.ts";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service.ts";
import { ModelProviderService as ModelProviderGateway } from "../services/model-provider.service.ts";
import { PlatformProviderChainService } from "../services/platform-provider-chain.service.ts";
import { buildModelProviderInfrastructure } from "./model-provider-composition.build.ts";
import type {
  CodexTokenRefresher,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialProbe,
  ModelTranslation,
} from "./model-provider.members.ts";

export type { ModelProviderCaller } from "@langwatch/model-provider-contract";

/** The feature key the translation call is priced and routed under. */
const TRANSLATE_FEATURE_KEY = "translate.text";

/**
 * The process's span reader, opaque here — only the process knows its concrete type. Carried
 * so the cost-rule preview reads through the same request-scoped services as the rest of the
 * call, rather than a process singleton.
 */
export type SpanReader = unknown;

/**
 * The technical members this module asks the process for. Each is a deployment's own answer
 * — its registry, egress fence, identifier format, OAuth issuer, counters, span reader — and
 * none of them is another module's service.
 */
export interface ModelProviderInfrastructure {
  /** The provider registry, and the system credentials this deployment holds. */
  catalog: ModelProviderCatalog;
  /** How a resolved model is executed, for the translation call. */
  translation: ModelTranslation;
  /** The one real generation Test Connection sends to the provider. */
  connectionPing: ModelProviderConnectionPing;
  /** The identifier format every row this module writes is minted in. */
  ids: ModelProviderIdFactory;
  /** The OAuth exchange a stored Codex token is refreshed through. */
  codexTokenRefresher: CodexTokenRefresher;
  /** The fixed windows a connection test is metered in. */
  connectionRateLimiter: ModelProviderConnectionRateLimiter;
  /**
   * The outbound credential probe, behind whatever egress fence the process
   * composed. A technical port: the network is the deployment's, the decision
   * about who may reach it is this application's.
   */
  credentialProbe: ModelProviderCredentialProbe;
  /**
   * The Codex device flow, named for the two answers this module asks for rather than the
   * class that gives them — the outbound `fetch` and the issuer are the deployment's, and
   * outside production the issuer is overridable.
   */
  codexAccounts: ModelProviderCodexDeviceFlow;
  /** The request's span reader, for the cost-rule preview. */
  spans: SpanReader;
}

/** The identifier format this deployment mints a provider, default or cost in. */
export interface ModelProviderIdFactory {
  generate(input: Readonly<{ type: "provider" | "default" | "cost" }>): string;
}

/** The two answers the Codex device ceremony asks of this deployment. */
export interface ModelProviderCodexDeviceFlow {
  startDeviceSignIn(): Promise<ModelProviderCodexDeviceSignIn>;
  pollDeviceSignIn(
    input: Readonly<{ deviceAuthId: string; userCode: string }>,
  ): Promise<ModelProviderCodexDeviceApproval>;
}

/** The engine address is the process's fact, not this module's env spelling. */
type ModelProviderMembers = MembersRead<readonly ["redis"]> &
  Readonly<{ nlpServiceUrl: string | undefined }>;

type ModelProviderSetup = FeatureSetup<
  typeof ModelProviderApp.dependencies,
  ModelProviderMembers,
  ModelProviderServerConfig,
  ModelProviderRepositories
>;

/**
 * The address a resolved model executes against when no NLP engine is
 * configured. Matches the deleted composition's own sentinel.
 */
const UNCONFIGURED_EXECUTION_PROXY = "http://nlp-engine-not-configured.invalid";

/** Where nlpgo answers the execution proxy, once an engine address is named. */
const EXECUTION_PROXY_PATH = "/go/proxy/v1";

/**
 * What {@link buildModelProviderInfrastructure} composes over, derived from
 * the contract's own config slice at `create()` rather than declared as a
 * second schema.
 */
export type ModelProviderBuildConfig = Readonly<{
  egress: Readonly<{ blockLocal: boolean; allowedHosts: string[]; verifyTls: boolean }>;
  /** Where a resolved model is executed, fully formed: nlpgo's `/go/proxy/v1`. */
  executionProxyBaseUrl: string;
  /** A system provider's fallback-credential env map. Always empty: see the handoff. */
  environment: Readonly<Record<string, string | undefined>>;
  /** Hosted-deployment flag. OUT OF SCOPE (config-schema-nuke-batch-c handoff): hardcoded false. */
  isSaas: boolean;
}>;

/**
 * The two roles a Codex account is licensed for: Langy's own, and the Fast
 * tier. The Default role — playground, evaluators, workflows — is deliberately
 * untouched, because those are not coding surfaces.
 */
const CODEX_CODING_ROLES = ["LANGY", "FAST"] as const;

export class ModelProviderApp implements ModelProviderApi {
  static readonly contract = ModelProviderApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    permissions: AuthzApi,
    dataPrivacy: DataPrivacyApi,
  };
  static readonly config = modelProviderConfig;
  /**
   * The platform's own provider credentials, keyed by registry provider. Every
   * one is optional: a deployment holding none dispatches on customer
   * credentials alone, which is what a self-hosted install does.
   */
  static readonly platformCredentials = {
    openai: openAiApiKey,
    openai_codex: Secret.load("CODEX_ACCESS_TOKEN", { optional: true }),
    anthropic: Secret.load("ANTHROPIC_API_KEY", { optional: true }),
    gemini: Secret.load("GEMINI_API_KEY", { optional: true }),
    google_agent_platform: Secret.load("GOOGLE_AGENT_PLATFORM_API_KEY", { optional: true }),
    azure: Secret.load("AZURE_OPENAI_API_KEY", { optional: true }),
    bedrock: Secret.load("AWS_ACCESS_KEY_ID", { optional: true }),
    deepseek: Secret.load("DEEPSEEK_API_KEY", { optional: true }),
    xai: Secret.load("XAI_API_KEY", { optional: true }),
    cerebras: Secret.load("CEREBRAS_API_KEY", { optional: true }),
    groq: Secret.load("GROQ_API_KEY", { optional: true }),
    voyage: Secret.load("VOYAGE_API_KEY", { optional: true }),
    elevenlabs: Secret.load("ELEVENLABS_API_KEY", { optional: true }),
    custom: Secret.load("CUSTOM_API_KEY", { optional: true }),
  } as const;
  /** What the module's own operations spend, never a platform provider credential. */
  static readonly operationalSecrets = {
    openRouter: Secret.load("OPENROUTER_API_KEY", { optional: true }),
  } as const;
  static readonly secrets = {
    ...ModelProviderApp.platformCredentials,
    ...ModelProviderApp.operationalSecrets,
  } as const;
  static readonly reads = [...reads("redis"), "nlpServiceUrl"] as const;

  static async create(setup: ModelProviderSetup): Promise<ModelProviderApp> {
    return ModelProviderApp.withPlatformChain(
      setup,
      await ModelProviderApp.resolvePlatformChain(setup.secrets),
    );
  }

  /**
   * One credential at a time, each closed over by the chain that carries it:
   * the collaborator escapes the resolver, the value never does (ADR-132 §6).
   */
  private static async resolvePlatformChain(
    secrets: ModelProviderSetup["secrets"],
  ): Promise<PlatformProviderChainService> {
    let chain = PlatformProviderChainService.create();
    for (const [provider, handle] of Object.entries(ModelProviderApp.platformCredentials)) {
      chain = await secrets.into(handle, (credential) => chain.with(provider, credential));
    }

    return chain;
  }

  private static withPlatformChain(
    { repositories, dependencies, members, config }: ModelProviderSetup,
    platformChain: PlatformProviderChainService,
  ): ModelProviderApp {
    const executionProxyBaseUrl = members.nlpServiceUrl
      ? `${members.nlpServiceUrl.replace(/\/$/, "")}${EXECUTION_PROXY_PATH}`
      : UNCONFIGURED_EXECUTION_PROXY;
    const buildConfig: ModelProviderBuildConfig = {
      egress: {
        blockLocal: config.blockLocalHttpCalls,
        allowedHosts: config.allowedProxyHosts,
        verifyTls: true,
      },
      executionProxyBaseUrl,
      environment: {},
      isSaas: false,
    };
    const infrastructure = buildModelProviderInfrastructure({
      members,
      config: buildConfig,
      dependencies,
    });
    return new ModelProviderApp({
      repositories,
      dependencies,
      members: infrastructure,
      executionProxyBaseUrl,
      platformChain,
    });
  }

  /**
   * Bypasses the config-driven build above for a suite that already decided every answer a
   * deployment would have supplied — no Redis, no secret resolver, no real egress. Production
   * never calls this; only `create` does.
   */
  static createForTesting(setup: {
    repositories: ModelProviderRepositories;
    dependencies: ModelProviderSetup["dependencies"];
    members: ModelProviderInfrastructure;
    executionProxyBaseUrl?: string;
    platformChain?: PlatformProviderChainService;
  }): ModelProviderApp {
    return new ModelProviderApp({
      repositories: setup.repositories,
      dependencies: setup.dependencies,
      members: setup.members,
      executionProxyBaseUrl:
        setup.executionProxyBaseUrl ?? "http://nlp-engine-not-configured.invalid",
      platformChain: setup.platformChain ?? PlatformProviderChainService.create(),
    });
  }

  /** The registry's ceilings, read from the catalogue this package ships. */
  readonly #limits = ModelLimitsService.create();
  /** The cost-rule preview, over the request's own span reader. */
  readonly #costPreview = ModelCostPreviewService.create({
    regexSafety: ModelCostRegexSafetyService.create(),
  });
  /**
   * The provider-failure policy one model call is wrapped in: the customer
   * reads this application's typed cause, and the provider's own words go to
   * the log, where internals belong.
   */
  readonly #aiCallFailures = AiCallFailureService.create();

  /** The read, write, defaults and cost lifecycles, over the chosen backend. */
  readonly #modelProviders: ModelProviderGateway;
  readonly #credentialProbe: ModelProviderCredentialProbe;
  readonly #codexAccounts: ModelProviderCodexDeviceFlow;
  readonly #spans: SpanReader;
  /**
   * The per-scope write check the provider commands already run, held here so
   * the credential probe is held to the same standing. Nothing downstream
   * re-authorizes a probe: it leaves for the vendor with the caller's keys.
   */
  readonly #providerAuthorization: ModelProviderWriteAuthorizationService;
  readonly #dataPrivacy: DataPrivacyApi;
  readonly #playground: ModelProviderPlaygroundService;
  readonly #evaluatorModelEnv: ModelProviderEvaluatorModelEnvService;
  readonly #structuredGeneration: ModelProviderStructuredGenerationService;

  private readonly platformChain: PlatformProviderChainService;

  private constructor({
    repositories,
    dependencies,
    members,
    executionProxyBaseUrl,
    platformChain,
  }: {
    repositories: ModelProviderRepositories;
    dependencies: ModelProviderSetup["dependencies"];
    members: ModelProviderInfrastructure;
    executionProxyBaseUrl: string;
    platformChain: PlatformProviderChainService;
  }) {
    this.platformChain = platformChain;
    this.#dataPrivacy = dependencies.dataPrivacy;
    this.#modelProviders = ModelProviderGateway.create({
      repository: repositories.providers,
      defaults: repositories.defaults,
      costs: repositories.costs,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      authorization: dependencies.permissions,
      credentialPolicy: ModelProviderKeysService.create(),
      catalog: members.catalog,
      translation: members.translation,
      connectionPing: members.connectionPing,
      ids: members.ids,
      codexTokenRefresher: members.codexTokenRefresher,
      connectionRateLimiter: members.connectionRateLimiter,
    });
    this.#providerAuthorization = ModelProviderWriteAuthorizationService.create(
      ModelProviderAuthorizationService.create(dependencies.permissions),
    );
    this.#credentialProbe = members.credentialProbe;
    this.#codexAccounts = members.codexAccounts;
    this.#spans = members.spans;
    // The same always-empty fallback map `ModelProviderBuildConfig.environment` carries.
    this.#evaluatorModelEnv = ModelProviderEvaluatorModelEnvService.create({
      modelProviders: this,
      environment: {},
    });
    this.#playground = ModelProviderPlaygroundService.create({
      modelProviders: this,
      executionProxyBaseUrl,
    });
    const execution = ModelProviderExecutionHandleService.create({
      modelProviders: this.#modelProviders,
      projects: dependencies.projects,
      executionProxyBaseUrl,
    });
    this.#structuredGeneration = ModelProviderStructuredGenerationService.create({
      execution,
    });
  }

  // ── providers ──────────────────────────────────────────────────────────────

  /** The project's providers, narrowest scope per provider key, keys masked. */
  getForProject(
    input: ModelProviderListProjectInput & { provider?: string },
  ): Promise<Record<string, ModelProviderSummary>> {
    return this.#modelProviders.getForProject(input);
  }

  findProviderForProject(input: {
    projectId: string;
    provider: string;
  }): Promise<ModelProvider | null> {
    return this.#modelProviders.findProviderForProject(input);
  }

  findRowServingModel(input: {
    projectId: string;
    provider: string;
    model: string;
  }): Promise<ModelProvider | null> {
    return this.#modelProviders.findRowServingModel(input);
  }

  getExecutionProviders(
    input: ModelProviderListProjectInput,
  ): Promise<Record<string, ModelProviderExecution>> {
    return this.#modelProviders.getExecutionProviders(input);
  }

  prepareExecution(
    input: ModelProviderExecutionPrepareInput,
  ): Promise<ModelProviderExecutionParameters> {
    return this.#modelProviders.prepareExecution(input);
  }

  prepareEvaluatorModelEnv(
    input: Parameters<ModelProviderApi["prepareEvaluatorModelEnv"]>[0],
  ): Promise<Record<string, string>> {
    return this.#evaluatorModelEnv.prepare(input);
  }

  generateStructured(input: ModelProviderStructuredGenerationInput): Promise<unknown> {
    return this.#structuredGeneration.generate(input);
  }

  runPlaygroundCompletion(
    input: ModelProviderPlaygroundRequest,
  ): Promise<ModelProviderPlaygroundCompletion> {
    return this.#playground.execute(input);
  }

  /** Every stored provider row the project can see, keys masked. */
  listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]> {
    return this.#modelProviders.listForProject(input);
  }

  /** Every saved row in the project's scope chain, unfiltered, keys masked. */
  findAllAccessibleForProject(
    input: ModelProviderListProjectInput,
  ): Promise<ModelProviderSummary[]> {
    return this.#modelProviders.findAllAccessibleForProject(input);
  }

  /** Every provider attached anywhere inside the organization, keys masked. */
  listForOrganization(input: ModelProviderListOrganizationInput): Promise<ModelProviderSummary[]> {
    return this.#modelProviders.listForOrganization(input);
  }

  /** Stores or replaces a provider row, attributed to the caller. */
  upsert(input: ModelProviderWriteRequest, by: ModelProviderCaller): Promise<ModelProvider> {
    return this.#modelProviders.upsert({ ...input, actorId: by.id });
  }

  /**
   * The project credential's own write. Nothing is attributed and nothing is
   * authorized here: the key was already held to `project:update` on the one
   * project it resolves to, which is the whole gate this door has ever had.
   */
  upsertUnattributed(input: ModelProviderWriteRequest): Promise<ModelProvider> {
    return this.#modelProviders.upsert(input);
  }

  /** Removes a provider row, attributed to the caller. */
  delete(input: ModelProviderDeleteRequest, by: ModelProviderCaller): Promise<void> {
    return this.#modelProviders.delete({ ...input, actorId: by.id });
  }

  /** Probes a credential that is already stored, attributed to the caller. */
  testConnection(
    input: ModelProviderTestConnectionRequest,
    by: ModelProviderCaller,
  ): Promise<ModelProviderCredentialVerdict> {
    return this.#modelProviders.testConnection({ ...input, actorId: by.id });
  }

  /**
   * Probes a credential the caller has just typed. The standing check runs
   * FIRST and is the whole gate: past it the keys leave this process for the
   * vendor, and nothing downstream asks again.
   */
  async validateApiKey(
    input: ModelProviderCredentialProbeRequest,
    by: ModelProviderCaller,
  ): Promise<ModelProviderCredentialVerdict> {
    await this.#providerAuthorization.assertCanWrite(by.id, [probedTenantScope(input)]);

    return this.#credentialProbe.probe({
      provider: input.provider,
      customKeys: input.customKeys,
    });
  }

  /** Probes the stored (or environment-fed) credential against a base URL. */
  validateStoredKey(
    input: ModelProviderStoredCredentialProbeRequest,
  ): Promise<ModelProviderCredentialVerdict> {
    return this.#credentialProbe.probeStored({
      projectId: input.projectId,
      provider: input.provider,
      customBaseUrl: input.customBaseUrl,
      modelProviders: this.#modelProviders,
    });
  }

  /** Codex step 1: ask the issuer for a device code. Nothing is stored yet. */
  startCodexDeviceSignIn(): Promise<ModelProviderCodexDeviceSignIn> {
    return this.#codexAccounts.startDeviceSignIn();
  }

  /** Codex step 2..n: one poll of the pending device authorization. */
  pollCodexDeviceSignIn(input: {
    deviceAuthId: string;
    userCode: string;
  }): Promise<ModelProviderCodexDeviceApproval> {
    return this.#codexAccounts.pollDeviceSignIn(input);
  }

  /** Whether LangWatch itself supplies this provider's credentials. */
  isManagedProvider(input: Readonly<{ organizationId: string; provider: string }>): boolean {
    return this.#modelProviders.isManagedProvider(input);
  }

  // ── the Codex account ──────────────────────────────────────────────────────

  /** The connected Codex account for a project. Never a token, never an email. */
  getCodexStatus(input: ModelProviderCodexStatusInput): Promise<ModelProviderCodexStatus> {
    return this.#modelProviders.getCodexStatus(input);
  }

  refreshCodexForGateway(
    input: ModelProviderCodexGatewayRefreshInput,
  ): Promise<ModelProviderCodexGatewayRefresh> {
    return this.#modelProviders.refreshCodexForGateway(input);
  }

  /**
   * Points the coding-assistant roles at the Codex model, at the widest scope picked.
   * Shared by the sign-in poll and the "yes please" dialog so both agree on the roles.
   */
  async applyCodexCodingDefaults(
    input: Readonly<{ scopes: readonly ModelDefaultScope[] }>,
    by: ModelProviderCaller,
  ): Promise<void> {
    // One scope is the norm — the sign-in surfaces pick the widest manageable
    // one — so this is scopes[0] in practice.
    const scope = input.scopes[0];
    if (!scope) return;
    for (const role of CODEX_CODING_ROLES) {
      await this.setDefault({ scope, key: role, model: CODEX_DEFAULT_MODEL }, by);
    }
  }

  /**
   * The providers this deployment holds its own keys for, in dispatch order.
   * Empty where it holds none, which is a self-hosted install's answer.
   */
  countEnabledInScopes(input: {
    scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
  }): Promise<number> {
    return this.#modelProviders.countEnabledInScopes(input);
  }

  countInOrganization(input: {
    organizationId: string;
    modelProviderIds: readonly string[];
  }): Promise<number> {
    return this.#modelProviders.countInOrganization(input);
  }

  findEnabledProviderKeysInScopes(input: {
    scopes: readonly { scopeType: "ORGANIZATION" | "TEAM" | "PROJECT"; scopeId: string }[];
  }): Promise<string[]> {
    return this.#modelProviders.findEnabledProviderKeysInScopes(input);
  }

  countUsage(input: { organizationIds: readonly string[] }): Promise<ModelProviderUsageCount> {
    return this.#modelProviders.countUsage(input);
  }

  async platformProviderChain(): Promise<PlatformProviderEntry[]> {
    return this.#dataPrivacy
      .intoGoogleApplicationCredentials((credential) =>
        this.platformChain.with("vertex_ai", credential),
      )
      .chain();
  }

  // ── default models ─────────────────────────────────────────────────────────

  /** What the cascade resolves for one feature key, or null when nothing is set. */
  findResolvedDefault(input: ModelDefaultResolveInput): Promise<ModelDefaultEffective | null> {
    return this.#modelProviders.findResolvedDefault(input);
  }

  resolveModelForFeature(input: ModelDefaultResolveInput): Promise<ModelProviderResolution> {
    return this.#modelProviders.resolveModelForFeature(input);
  }

  findAlternateModel(input: {
    projectId: string;
    featureKey: string;
    skipFromScope: ModelProviderResolution["scope"];
  }): Promise<ModelProviderAlternateResolution> {
    return this.#modelProviders.findAlternateModel(input);
  }

  /** The Default Models settings page's snapshot, scoped to what the caller may write. */
  getDefaultSnapshot(
    input: ModelDefaultSnapshotRequest,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultSnapshot> {
    return this.#modelProviders.getDefaultSnapshot({ ...input, actorId: by.id });
  }

  /** The same snapshot read as nobody, for a credential that names no person. */
  getDefaultSnapshotUnattributed(
    input: ModelDefaultSnapshotRequest,
  ): Promise<ModelDefaultSnapshot> {
    return this.#modelProviders.getDefaultSnapshot(input);
  }

  /**
   * Assigns one role or feature key at one scope, attributed to the caller. The service takes
   * the caller twice — as the author of the value and as the actor of the write, always the
   * same person — filling both here stops a handler filling one and forgetting the other.
   */
  setDefault(input: ModelDefaultAssignmentRequest, by: ModelProviderCaller): Promise<void> {
    return this.#modelProviders.setDefault({
      ...input,
      authorId: by.id,
      actorId: by.id,
    });
  }

  /** Saves a whole default-models config and its scope attachments. */
  saveDefaultConfig(
    input: ModelDefaultConfigWriteRequest,
    by: ModelProviderCaller,
  ): Promise<ModelDefaultConfig> {
    return this.#modelProviders.saveDefaultConfig({
      ...input,
      authorId: by.id,
      actorId: by.id,
    });
  }

  /** Deletes a default-models config and every scope attachment it holds. */
  deleteDefaultConfig(input: ModelDefaultDeleteRequest, by: ModelProviderCaller): Promise<void> {
    return this.#modelProviders.deleteDefaultConfig({ ...input, actorId: by.id });
  }

  assertApiKeyMayWriteDefaultScopes(input: ModelDefaultApiKeyScopeCheck): Promise<void> {
    return this.#modelProviders.assertApiKeyMayWriteDefaultScopes(input);
  }

  findDefaultConfig(input: { id: string }): Promise<ModelDefaultConfig | null> {
    return this.#modelProviders.findDefaultConfig(input);
  }

  /** What the cascade would hand back for these scopes if they held nothing. */
  getInheritedValues(
    input: Readonly<{
      projectId: string;
      scopes: ModelDefaultScope[];
      excludeConfigId?: string;
    }>,
  ): Promise<ModelDefaultInheritedValues> {
    return this.#modelProviders.getInheritedValues(input);
  }

  // ── model costs ────────────────────────────────────────────────────────────

  /** The project's custom cost rules. */
  listCosts(input: ModelCostListInput): Promise<ModelCost[]> {
    return this.#modelProviders.listCosts(input);
  }

  estimateCost(input: ModelCostEstimateInput): number {
    return this.#modelProviders.estimateCost(input);
  }

  /** Writes one cost rule at a scope the caller may manage, attributed to them. */
  upsertCost(input: ModelCostWriteRequest, by: ModelProviderCaller): Promise<ModelCost> {
    return this.#modelProviders.upsertCost({ ...input, actorId: by.id });
  }

  /** Removes one cost rule, authorized against the STORED row's scope. */
  deleteCost(input: ModelCostDeleteRequest, by: ModelProviderCaller): Promise<void> {
    return this.#modelProviders.deleteCost({ ...input, actorId: by.id });
  }

  /** The registry's ceilings for a model id, or null when it names no such model. */
  findModelLimits(input: { model: string }): ModelLimits | null {
    return this.#limits.pickModelLimits(input.model);
  }

  /**
   * What a cost rule the caller is still typing would match, priced under rates entered so far.
   * Throws when no span reader was composed, rather than a false "no matching spans".
   */
  previewCostRuleMatchingSpans(
    input: ModelCostPreviewRequest,
  ): Promise<CostRuleMatchingSpansPreview> {
    const spans = this.#spans;

    if (!isPreviewSpanReader(spans)) throw new ModelCostPreviewUnavailableError();

    return this.#costPreview.previewCostRuleMatchingSpans({ spans, input });
  }

  // ── translation ────────────────────────────────────────────────────────────

  /**
   * Translates content the caller is already looking at. Wrapped in the provider-failure
   * policy here rather than at a door, so every caller reads the same typed cause and the
   * provider's own words reach the log rather than the browser.
   */
  translate(input: TranslateInput): Promise<TranslateOutput> {
    const feature = findFeatureByKey(TRANSLATE_FEATURE_KEY)[0];

    // A missing registry entry is a build-time mistake, not a customer-actionable
    // cause, so it stays a plain Error and degrades to unknown plus a trace id.
    if (!feature) throw new Error(`${TRANSLATE_FEATURE_KEY} feature is not registered`);

    return this.#aiCallFailures.wrapAiCall(feature, () => this.#modelProviders.translate(input));
  }
}

/**
 * The tenant a probe is authorized against: the project when one is named,
 * the organization otherwise. The wire schema refuses a request naming
 * neither, so reaching here with neither is a wiring mistake, not a caller's.
 */
function probedTenantScope(input: ModelProviderCredentialProbeRequest): ModelDefaultScope {
  if (input.projectId) return { scopeType: "PROJECT", scopeId: input.projectId };

  if (input.organizationId) {
    return { scopeType: "ORGANIZATION", scopeId: input.organizationId };
  }

  throw new ModelProviderAnchorRequiredError("project_or_organization");
}

/** Whether this application's opaque span handle answers the two preview reads. */
function isPreviewSpanReader(spans: SpanReader): spans is ModelCostPreviewSpanReader {
  const candidate = spans as Partial<ModelCostPreviewSpanReader> | null | undefined;

  return (
    typeof candidate?.getModelUsageStats === "function" &&
    typeof candidate?.getRecentSpansByModels === "function"
  );
}
