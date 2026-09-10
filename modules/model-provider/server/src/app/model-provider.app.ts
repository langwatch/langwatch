/**
 * The model-provider feature's application: what its three doors call.
 *
 * `modelProvider.*`, `llmModelCost.*` and `translate.*` are all this feature
 * answering, and before this each declared its own private bag —
 * `Readonly<{ modelProviders: ModelProviderGateway }>` in two of them and
 * `Readonly<{ modelProviders; traces: { spans } }>` in the third. Three
 * descriptions of one composition, agreeing by attention rather than by
 * construction, and none of them reachable from the others.
 *
 * Most operations are the service's own, reached through the dependency below.
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - attributing a write to its caller. Eleven handlers stamped it for
 *     themselves, under two different field names (`actorId` on every write,
 *     `authorId` as well on a default assignment), which is exactly the kind
 *     of detail a transport should never be trusted to get right twice;
 *   - pointing the coding-assistant roles at the Codex model, which
 *     `codexSignInPoll` and `codexApplyCodingDefaults` each looped over for
 *     themselves with the same two roles and the same model.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and a
 * background job without knowing which it is serving.
 */
import {
  CODEX_DEFAULT_MODEL,
  featureByKey,
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
  type ModelProviderListOrganizationInput,
  type ModelProviderListProjectInput,
  type ModelProviderResolution,
  type ModelProviderSummary,
  type TranslateInput,
  type TranslateOutput,
} from "@langwatch/model-provider-contract";

import { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";

import { AiCallFailureService } from "../services/ai-call-failure.service.ts";
import { ModelCostRegexSafetyService } from "../services/model-cost-regex-safety.service.ts";
import { ModelLimitsService } from "../services/model-limits.service.ts";
import {
  ModelCostPreviewService,
  type ModelCostPreviewSpanReader,
} from "../services/model-cost-preview.service.ts";
import type {
  CodexTokenRefresher,
  ModelProviderCatalog,
  ModelProviderConnectionRateLimiter,
  ModelProviderCredentialProbe,
  ModelTranslation,
} from "./model-provider.infrastructure.ts";
import type { ModelProviderRepositories } from "../repositories/model-provider.repositories.ts";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service.ts";
import { ModelProviderKeysService } from "../services/model-provider-keys.service.ts";
import { ModelProviderService as ModelProviderGateway } from "../services/model-provider.service.ts";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service.ts";

export type { ModelProviderCaller } from "@langwatch/model-provider-contract";

/** The feature key the translation call is priced and routed under. */
const TRANSLATE_FEATURE_KEY = "translate.text";

/**
 * The process's span reader, opaque here. Only the process knows its concrete
 * type; this application carries the handle so the cost-rule preview reads
 * through the SAME request-scoped services as the rest of the call rather than
 * a process singleton.
 */
export type SpanReader = unknown;

/**
 * The technical infrastructure this module asks the process for. Every member
 * is a deployment's own answer - its provider registry, its egress fence, its
 * identifier format, its OAuth issuer, its counters, its span reader - and
 * none of them is another module's service.
 */
export interface ModelProviderInfrastructure {
  /** The provider registry, and the system credentials this deployment holds. */
  catalog: ModelProviderCatalog;
  /** How a resolved model is executed, for the translation call. */
  translation: ModelTranslation;
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
   * The Codex device flow. Named as the two answers this module asks for
   * rather than as the class that gives them, because the outbound `fetch`
   * and the issuer behind them are the deployment's, and outside production
   * the issuer is overridable.
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

type ModelProviderSetup = FeatureSetup<
  typeof ModelProviderApp.dependencies,
  ModelProviderInfrastructure,
  undefined,
  ModelProviderRepositories
>;

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
  };

  static create({
    repositories,
    dependencies,
    infrastructure,
  }: ModelProviderSetup): ModelProviderApp {
    return new ModelProviderApp(repositories, dependencies, infrastructure);
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

  private constructor(
    repositories: ModelProviderRepositories,
    dependencies: ModelProviderSetup["dependencies"],
    infrastructure: ModelProviderInfrastructure,
  ) {
    this.#modelProviders = ModelProviderGateway.create({
      repository: repositories.providers,
      defaults: repositories.defaults,
      costs: repositories.costs,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      authorization: dependencies.permissions,
      credentialPolicy: ModelProviderKeysService.create(),
      catalog: infrastructure.catalog,
      translation: infrastructure.translation,
      ids: infrastructure.ids,
      codexTokenRefresher: infrastructure.codexTokenRefresher,
      connectionRateLimiter: infrastructure.connectionRateLimiter,
    });
    this.#providerAuthorization = ModelProviderWriteAuthorizationService.create(
      ModelProviderAuthorizationService.create(dependencies.permissions),
    );
    this.#credentialProbe = infrastructure.credentialProbe;
    this.#codexAccounts = infrastructure.codexAccounts;
    this.#spans = infrastructure.spans;
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

  /** Every stored provider row the project can see, keys masked. */
  listForProject(input: ModelProviderListProjectInput): Promise<ModelProviderSummary[]> {
    return this.#modelProviders.listForProject(input);
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
    await this.#providerAuthorization.assertCanWrite(by.id, [
      probedTenantScope(input),
    ]);

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
   * Points the coding-assistant roles at the Codex model.
   *
   * Role-level writes rather than per-feature ones, at the widest scope the
   * caller picked: the values cascade down from there. Written here because
   * both the sign-in poll and the after-the-fact "yes please" dialog perform
   * exactly this, and two copies of "which roles a Codex account serves" is
   * two chances to answer it differently.
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
   * Assigns one role or feature key at one scope, attributed to the caller.
   *
   * The service takes the caller twice — as the author of the value and as the
   * actor of the write — and they are always the same person. Filling both
   * here is what stops a handler filling one and forgetting the other.
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
    return this.#limits.tryGetModelLimits(input.model);
  }

  /**
   * What a cost rule the caller is still typing would match, priced under the
   * rates they have entered so far.
   *
   * The reader is the trace read stack's, carried through this application as
   * an opaque handle: only a process that composed one knows its concrete
   * type, and a process that composed none must say so rather than answering
   * "no matching spans" — an empty preview would talk somebody out of a rule
   * that works.
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
   * Translates content the caller is already looking at.
   *
   * Wrapped in the provider-failure policy here rather than at a door, so
   * every caller reads the same typed cause and the provider's own words
   * reach the log rather than the browser.
   */
  translate(input: TranslateInput): Promise<TranslateOutput> {
    const feature = featureByKey(TRANSLATE_FEATURE_KEY);

    // A missing registry entry is a build-time mistake, not a customer-actionable
    // cause, so it stays a plain Error and degrades to unknown plus a trace id.
    if (!feature) throw new Error(`${TRANSLATE_FEATURE_KEY} feature is not registered`);

    return this.#aiCallFailures.wrapAiCall(feature, () =>
      this.#modelProviders.translate(input),
    );
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
