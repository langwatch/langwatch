/**
 * Materialise GET /api/internal/gateway/config/:vk_id (bundle shape: contract §4.2). Source of truth post VK-binding-collapse: GatewayProviderCredential is gone, ModelProvider absorbed its gateway fields, and the VK's eligible-provider set computes from the VirtualKeyScope graph + optional RoutingPolicy.modelProviderIds ordering (scopeResolver.ts).
 */
import type { GatewayBudget, ModelProvider, VirtualKey } from "@langwatch/prisma-client/generated";

import { GatewayConfigAssemblyPort } from "../ports/gateway-config-assembly.port";
import type { GatewayModelProviderCredentialsPort } from "../ports/gateway-model-provider-credentials.port";
import { resolveLangyMirrorTier, type LangyMirrorTier } from "@langwatch/langy-contract";
import { modelProviders } from "@langwatch/model-provider-contract";
import { GatewayBudgetSpendPort } from "../ports/gateway-budget-spend.port";
import type { ProjectService } from "@langwatch/project-contract";
import {
  budgetPeriodFloorMs,
  effectiveBudgetPeriod,
  parseVirtualKeyConfig,
  type GatewayBudgetResource,
  type GatewayCacheRuleResource,
  type GatewayConfigGuardrailAttachment,
  type GatewayGuardrailBundleEntry,
  type GatewayMoney,
  type GatewayResolvedBudget,
  type GatewayService,
} from "@langwatch/gateway-contract";
import type { GatewayScopeResolutionService } from "./gateway-scope-resolution.service";
import { type VirtualKeyWithScopes } from "../ports/gateway-virtual-key.port";

export type GuardrailWire = {
  id: string;
  name: string;
  evaluator_id: string;
  evaluator_slug: string | null;
  direction: "pre" | "post" | "stream_chunk";
  failure_mode: "fail_open" | "fail_closed";
};

export type GuardrailAttachmentWire = {
  direction: "pre" | "post" | "stream_chunk";
  guardrail_ids: string[];
};

export type ProviderSlot = {
  /**
   * ModelProvider.id — the Go gateway keys credentials on this directly
   * post-collapse (was the GPC id pre-collapse; one-to-one fold means
   * the wire name `id` stays the same).
   */
  id: string;
  slot: string;
  type: string;
  /**
   * Opaque per-provider credentials blob, matching the Go gateway's pcToBifrostKey shape per provider type (OpenAI/Anthropic/Gemini: {api_key}; Azure: +endpoint/api_version; Bedrock: access/secret/session/region; Vertex: project/region/auth_credentials). Decrypted from ModelProvider.customKeys (AES-256-GCM at rest).
   */
  credentials: Record<string, unknown>;
  base_url?: string;
  region?: string;
  deployment_map?: Record<string, string>;
  /**
   * Operator-chosen routing handle for this ModelProvider row — a caller writes it where a provider family goes ("eu/claude-sonnet-5") to reach THIS instance rather than whichever the key's chain order reaches first. Absent when the operator set none.
   */
  handle?: string;
  /**
   * What this provider declares it serves, for ROUTING a bare model name to its owner. Absent means "said nothing", not "serves nothing" — authorization stays with models_allowed.
   */
  models?: string[];
  config: Record<string, unknown>;
};

/**
 * A ModelProvider row the gateway won't dispatch to, named so a request-time block can say why. type carries ModelProvider.provider alongside the row id, since the gateway matches a resolved request by provider kind and these rows are absent from providers[].
 */
export type ProviderExclusionWire = {
  id: string;
  type: string;
  /**
   * The dropped row's routing handle, carried so a request naming it is told
   * which of the key's settings dropped the provider instead of being told the
   * operator's own handle means nothing.
   */
  handle?: string;
};

export type GatewayConfigPayload = {
  revision: string;
  vk_id: string;
  status: "active" | "revoked";
  display_prefix: string;
  organization_id: string;
  /**
   * project_id/project_otlp_token/team_id populate when the VK has a single PROJECT scope, or the org has an internal_governance project (TEAM/ORG-scoped VKs route traces there so Governance shows VK + receiver spans under one filter). Null for older self-hosted orgs without one — the gateway skips span export rather than failing the config fetch.
   */
  project_id: string | null;
  project_otlp_token: string | null;
  team_id: string | null;
  principal_id: string | null;
  providers: ProviderSlot[];
  /**
   * `chain` is the ordered provider slots; `max_attempts` bounds the walk.
   * Which failures walk it is decided by the gateway from the real upstream
   * outcome, never per key.
   */
  fallback: {
    chain: string[];
    max_attempts: number;
  };
  model_aliases: Record<string, string>;
  models_allowed: string[] | null;
  /**
   * Explicit provider allowlist. null means every provider the key can reach through its scope graph, now and future — the semantic "All providers" gives, so a provider added next month is usable unedited. A list narrows to those ModelProvider ids (providers[] is already filtered to match); shipped so the gateway can say WHY a model is unavailable.
   */
  providers_allowed: string[] | null;
  /**
   * How the key behaves when its provider fails: "none" = no failover (default post routing-mode split); "fallback_all" = walk every eligible provider; "policy" = the linked RoutingPolicy decides.
   */
  routing_mode: "none" | "fallback_all" | "policy";
  /**
   * Contract §4.2. Providers a request could resolve to but the gateway will NOT dispatch to, split by WHY, each carrying the {id, type} shape providers[] uses (matched by TYPE). routing_excluded_providers: reachable + in access, dropped by the routing policy. access_excluded_providers: reachable, outside providers_allowed. Absent from both and from providers[] means unreachable from the key's scope at all.
   */
  routing_excluded_providers: ProviderExclusionWire[];
  access_excluded_providers: ProviderExclusionWire[];
  /**
   * Display name of the key's routing policy, used to name the routing-block
   * reason. Null when the key is not on a routing policy.
   */
  routing_policy_name: string | null;
  cache: { mode: "respect" | "force" | "disable"; ttl_s: number };
  // Flat per-project guardrail catalog the VK is allowed to reference.
  // The Go dispatcher looks up entries by id from guardrail_attachments
  // and invokes them per direction.
  guardrails: GuardrailWire[];
  guardrail_attachments: GuardrailAttachmentWire[];
  policy_rules: {
    tools: { deny: string[]; allow: string[] | null };
    mcp: { deny: string[]; allow: string[] | null };
    urls: { deny: string[]; allow: string[] | null };
    models: { deny: string[]; allow: string[] | null };
  };
  rate_limits: {
    rpm: number | null;
    tpm: number | null;
    rpd: number | null;
  };
  budgets: Array<{
    id: string;
    scope:
      | "organization"
      | "team"
      | "project"
      | "virtual_key"
      | "principal"
      | "group"
      | "attributed_user";
    /**
     * The bucket spend accumulates under. Equal to the budget's target for
     * every scope except "group", where it is `<groupId>:<userId>` so each
     * member of a group gets their own allowance.
     */
    scope_id: string;
    /** Only set for "group": the member this bucket belongs to. */
    principal_id?: string;
    /**
     * Only set for "attributed_user": the entry is a TEMPLATE (per-window limit for each distinct end user on this anchor). scope_id stays the ANCHOR; per-user spend is unbounded cardinality and never materialises here — the gateway fetches the request's bucket via its cached bucket-spend read. spent_micro_usd is 0 on templates.
     */
    per_user?: true;
    /**
     * Provider filter. Null = the budget counts every dispatch; set = it counts and constrains only dispatches to that ModelProvider id, so a breach removes that provider from the chain instead of blocking the whole request.
     */
    provider_key: string | null;
    window: string;
    limit_micro_usd: number;
    spent_micro_usd: number;
    resets_at: number;
    on_breach: "block" | "warn";
  }>;
  cache_rules: Array<{
    id: string;
    priority: number;
    matchers: {
      vk_id?: string;
      vk_tags?: string[];
      vk_prefix?: string;
      principal_id?: string;
      model?: string;
      request_metadata?: Record<string, string>;
    };
    action: {
      mode: "respect" | "force" | "disable";
      ttl?: number;
      salt?: string;
    };
  }>;
  /**
   * ADR-061 mirror tier. Present and non-skip ONLY for Langy virtual keys, so the gateway never mirrors ordinary customer traffic — read here (never a client header) to decide whether to duplicate the gen_ai span into the mirror project.
   */
  langy_mirror_tier: LangyMirrorTier;
  metadata: Record<string, unknown>;
  // The VK's operator-assigned tags, lifted from config.metadata.tags.
  // The gateway stamps them on customer spans as langwatch.labels (Trace
  // Explorer "Label" filter) and matches cache-rule vk_tags against them.
  vk_tags: string[];
  /**
   * Key's expiry, unix seconds, null if never — always present so the gateway can tell an explicit null apart from a field an older control plane never sent ("keep the date you hold"). Also travels on the auth token as vk_expires_at (mint-time floor); carrying it here too bounds how long the gateway can hold a stale value, since the ETag moves on every mutation and a changed date reaches the gateway on its next revalidation even while the change feed is down.
   */
  expires_at: number | null;
};

export class GatewayConfigMaterialiserService {
  private constructor(
    /** Which providers a key reaches, and in which dispatch order. */
    private readonly scopeResolution: GatewayScopeResolutionService,
    private readonly projects: ProjectService,
    private readonly chRepo: GatewayBudgetSpendPort | null,
    /**
     * The process's own Gateway service. Required, not defaulted — building one here meant composing a second service per request over the same tables the App already had one for, and the default couldn't be completed once that service grew guardrail/cache-rule collaborators.
     */
    private readonly budgetDecisions: GatewayService,
    /**
     * Reads a provider row's stored keys. A port because the cipher belongs to
     * the Model Provider feature and a gateway package may not depend on
     * another feature's server package.
     */
    private readonly credentials: GatewayModelProviderCredentialsPort,
    /**
     * The version token, the reserved tier vocabulary and the shipped model
     * catalog: the three reads the bundle needs that are not this service's
     * own logic.
     */
    private readonly assembly: GatewayConfigAssemblyPort,
    /**
     * The mirror project this deployment names, if any. Stated by the
     * composition root rather than read here: a package receives its
     * deployment facts as configuration.
     */
    private readonly langyMirrorProjectId: string | undefined,
  ) {}

  static create(input: {
    scopeResolution: GatewayScopeResolutionService;
    projects: ProjectService;
    chRepo: GatewayBudgetSpendPort | null;
    budgetDecisions: GatewayService;
    credentials: GatewayModelProviderCredentialsPort;
    assembly: GatewayConfigAssemblyPort;
    /** `LANGY_MIRROR_PROJECT_ID`; absent means nothing is mirrored. */
    langyMirrorProjectId?: string | undefined;
  }): GatewayConfigMaterialiserService {
    return new GatewayConfigMaterialiserService(
      input.scopeResolution,
      input.projects,
      input.chRepo,
      input.budgetDecisions,
      input.credentials,
      input.assembly,
      input.langyMirrorProjectId,
    );
  }

  /**
   * Providers this key dispatches to, plus the three wire fields naming why a resolved provider wasn't used. An explicit allowlist narrows dispatch; absence means every scope-reachable provider, now and later — filtered here, not frozen into stored scope rows. eligibleProviders is already routing-policy-applied, so scope-reachable minus dispatch is what the policy dropped, and the allowlist complement is what access dropped.
   */
  private async dispatchAndExclusions(
    vk: VirtualKeyWithScopes,
    eligibleProviders: ModelProvider[],
    allowed: string[] | null,
  ): Promise<{
    providers: ModelProvider[];
    exclusions: {
      routing_excluded_providers: ProviderExclusionWire[];
      access_excluded_providers: ProviderExclusionWire[];
      routing_policy_name: string | null;
    };
  }> {
    const providers = allowed
      ? eligibleProviders.filter((mp) => allowed.includes(mp.id))
      : eligibleProviders;
    const scopeReachable = await this.scopeResolution.scopeReachableModelProvidersForVk(vk);
    const { routingExcluded, accessExcluded } = providerExclusions({
      scopeReachable,
      eligibleProviders,
      allowed,
    });

    return {
      providers,
      exclusions: {
        routing_excluded_providers: routingExcluded.map(providerExclusionWire),
        access_excluded_providers: accessExcluded.map(providerExclusionWire),
        routing_policy_name: vk.routingPolicy?.name ?? null,
      },
    };
  }

  /**
   * Version token for the bundle materialise would build for vk. Lives beside materialise since it describes that output — the token must move whenever the bundle would differ, and drifting apart is what lets a 304 confirm a stale bundle. See configETag.ts for what it covers vs the change feed.
   */
  async versionToken(vk: VirtualKeyWithScopes): Promise<string> {
    return await this.assembly.versionToken(vk);
  }

  async materialise(vk: VirtualKeyWithScopes): Promise<GatewayConfigPayload> {
    const eligibleProviders = await this.scopeResolution.eligibleModelProvidersForVk(vk);
    const traceProject = vk.traceProjectId
      ? await this.projects.tryGetTraceDestination(vk.traceProjectId)
      : null;
    const budgets = await this.applicableBudgets(vk, traceProject);
    const spendByBudgetId = await this.loadCurrentSpend(vk, budgets);
    const config = parseVirtualKeyConfig(vk.config);
    const { providers, exclusions } = await this.dispatchAndExclusions(
      vk,
      eligibleProviders,
      config.providersAllowed,
    );
    const policySides = resolvePolicySideOfBundle(vk, config, this.assembly);
    // The cache-rule bundle, the project's guardrail catalogue and the key's
    // surviving attachments come from the one Gateway service that owns those
    // tables, rather than from a second copy of each query living here.
    const bundle = await this.budgetDecisions.loadConfigurationPersistence({
      organizationId: vk.organizationId,
      traceProjectId: traceProject?.id ?? null,
      guardrailAttachments: config.guardrailAttachments.map((attachment) => ({
        direction: attachment.direction,
        guardrailIds: [...attachment.guardrailIds],
      })),
    });

    return {
      revision: vk.revision.toString(),
      vk_id: vk.id,
      status: vk.status === "ACTIVE" ? "active" : "revoked",
      display_prefix: vk.displayPrefix,
      organization_id: vk.organizationId,
      project_id: traceProject?.id ?? null,
      project_otlp_token: traceProject?.apiKey ?? null,
      team_id: traceProject?.teamId ?? null,
      principal_id: vk.principalUserId,
      // ADR-061: only a Langy VK's calls are mirrored — the gen_ai span is the
      // one part of a Langy turn's trace the manager's relay never sees. Every
      // other VK resolves to skip, so ordinary customer traffic is never
      // duplicated into LangWatch's mirror project.
      langy_mirror_tier:
        vk.purpose === "LANGY" && traceProject?.id
          ? resolveLangyMirrorTier(
              { projectId: traceProject.id },
              { LANGY_MIRROR_PROJECT_ID: this.langyMirrorProjectId },
            )
          : "skip",
      providers: providers.map((mp, index) =>
        buildProviderSlot(mp, index, this.credentials, this.assembly),
      ),
      fallback: {
        chain: providers.map((mp) => mp.id),
        // routing_mode NONE means the request never leaves the provider
        // that serves the model, so the attempt budget is one. Pinning it
        // here makes no-fallback real for gateways that predate the
        // routing_mode field instead of promising it in the UI only.
        max_attempts: vk.routingMode === "NONE" ? 1 : config.fallback.maxAttempts,
      },
      model_aliases: policySides.modelAliases,
      models_allowed: config.modelsAllowed,
      providers_allowed: config.providersAllowed,
      routing_mode: routingModeToWire(vk.routingMode),
      ...exclusions,
      cache: { mode: config.cache.mode, ttl_s: config.cache.ttlS },
      guardrails: bundle.guardrails.map(guardrailToWire),
      guardrail_attachments: bundle.attachments.map(guardrailAttachmentToWire),
      policy_rules: policySides.policyRules,
      rate_limits: {
        rpm: config.rateLimits.rpm,
        tpm: config.rateLimits.tpm,
        rpd: config.rateLimits.rpd,
      },
      budgets: budgets.map((resolved) => budgetToWire(resolved, spendByBudgetId)),
      cache_rules: bundle.cacheRules.map(cacheRuleToWire),
      metadata: config.metadata ?? {},
      vk_tags: config.metadata?.tags ?? [],
      expires_at: expiresAtWire(vk.expiresAt),
    };
  }

  /**
   * CH spend rollup, best-effort: falls back to PG spentUsd when CH isn't wired (test fixtures, CH-less deploys). Tenant set = every project under the VK's org, so ORG/TEAM/PRINCIPAL budgets see ledger rows under whichever project emitted the trace.
   */
  private async loadCurrentSpend(
    vk: VirtualKeyWithScopes,
    budgets: GatewayResolvedBudget[],
  ): Promise<Map<string, string>> {
    if (this.chRepo === null || budgets.length === 0) {
      return new Map();
    }

    try {
      const tenantIds = await this.budgetDecisions.listSpendTenantIds(vk.organizationId);
      if (tenantIds.length === 0) {
        return new Map();
      }

      // Read each budget's spend from its RESOLVED bucket, exactly. The
      // bundle enforces this key's buckets, so the figure must be the
      // bucket's own: a GROUP budget read from the raw row would prefix-sum
      // every member's bucket, and the gateway would then cap each member
      // at what the whole group spent together.
      const spends = await this.chRepo.getSpendForBudgetsAcrossTenants(
        tenantIds,
        budgets
          // Templates have no single bucket to read; their per-user spend
          // is fetched request-side through the bucket-spend endpoint.
          .filter((r) => r.budget.scopeType !== "ATTRIBUTED_USER")
          .map((r) => ({
            budgetId: r.budget.id,
            scope: r.budget.scopeType,
            scopeId: r.bucketScopeId,
            window: r.budget.window,
            match: "exact" as const,
            periodFloorMs: budgetPeriodFloorMs(r.budget),
          })),
      );
      const out = new Map<string, string>();
      for (const s of spends) {
        out.set(s.budgetId, s.spentUsd);
      }

      return out;
    } catch {
      return new Map();
    }
  }

  /**
   * Every budget applying to this VK: ORG/VK-scope always apply; TEAM/PROJECT only when a trace project resolves (single-project-scope VK or governance fallback); PRINCIPAL and per-member GROUP only when the key carries a principal. Scope semantics live in the shared resolver the request-time check and debits process also call, so the bundle can never disagree with them.
   */
  private async applicableBudgets(
    vk: VirtualKeyWithScopes,
    traceProject: { id: string; teamId: string } | null,
  ): Promise<GatewayResolvedBudget[]> {
    return this.budgetDecisions.resolveApplicableBudgets({
      organizationId: vk.organizationId,
      virtualKeyId: vk.id,
      teamId: traceProject?.teamId ?? null,
      projectId: traceProject?.id ?? null,
      principalUserId: vk.principalUserId,
    });
  }
}

// Resolves the policy-side of the bundle (model aliases + rules) from the
// VK's RoutingPolicy when present, else the VK config defaults — legacy VK
// config keys are stripped post bug-7 step (iv), so the fallback is always
// empty and the RP read becomes source of truth once routingPolicyId is set.
// Empty-rules normalize to the wire-contracted shape regardless of DB content.
type BundlePolicyRules = GatewayConfigPayload["policy_rules"];

const EMPTY_POLICY_RULE_DIM = {
  deny: [] as string[],
  allow: null as string[] | null,
};

function emptyPolicyRules(): BundlePolicyRules {
  return {
    tools: { ...EMPTY_POLICY_RULE_DIM },
    mcp: { ...EMPTY_POLICY_RULE_DIM },
    urls: { ...EMPTY_POLICY_RULE_DIM },
    models: { ...EMPTY_POLICY_RULE_DIM },
  };
}

function mergePolicyDim(raw: unknown): {
  deny: string[];
  allow: string[] | null;
} {
  if (!raw || typeof raw !== "object") {
    return { ...EMPTY_POLICY_RULE_DIM };
  }

  const r = raw as { deny?: unknown; allow?: unknown };
  const deny = Array.isArray(r.deny)
    ? r.deny.filter((x): x is string => typeof x === "string")
    : [];
  const allow =
    r.allow === null || r.allow === undefined
      ? null
      : Array.isArray(r.allow)
        ? r.allow.filter((x): x is string => typeof x === "string")
        : null;

  return { deny, allow };
}

function normalisePolicyRules(raw: unknown): BundlePolicyRules {
  if (!raw || typeof raw !== "object") {
    return emptyPolicyRules();
  }

  const r = raw as Record<string, unknown>;

  return {
    tools: mergePolicyDim(r.tools),
    mcp: mergePolicyDim(r.mcp),
    urls: mergePolicyDim(r.urls),
    models: mergePolicyDim(r.models),
  };
}

function resolvePolicySideOfBundle(
  vk: VirtualKeyWithScopes,
  _config: ReturnType<typeof parseVirtualKeyConfig>,
  assembly: GatewayConfigAssemblyPort,
): {
  modelAliases: Record<string, string>;
  policyRules: BundlePolicyRules;
} {
  const rp = vk.routingPolicy;
  if (!rp) {
    return { modelAliases: {}, policyRules: emptyPolicyRules() };
  }

  const aliasesRaw = rp.modelAliases;
  const aliases: Record<string, string> =
    aliasesRaw && typeof aliasesRaw === "object" && !Array.isArray(aliasesRaw)
      ? Object.fromEntries(
          Object.entries(aliasesRaw as Record<string, unknown>).filter(
            ([, v]) => typeof v === "string",
          ) as Array<[string, string]>,
        )
      : {};

  return {
    modelAliases: assembly.withTierFallthrough({
      aliases,
      defaultModel: rp.defaultModel,
    }),
    policyRules: normalisePolicyRules(rp.policyRules),
  };
}

function buildProviderSlot(
  mp: ModelProvider,
  index: number,
  credentialReader: GatewayModelProviderCredentialsPort,
  assembly: GatewayConfigAssemblyPort,
): ProviderSlot {
  const credentials = assembly.buildCredentials(mp, credentialReader);
  const customKeys = credentialReader.readCustomKeys(mp.customKeys);
  // Base-URL override the gateway consumes (mapProvider in bifrost.go):
  // "custom"/"openai" route to Bifrost's VLLM adapter; "anthropic" derives
  // a custom provider for self-hosted /v1/messages; "elevenlabs" needs it
  // for realtime session residency. Registry indexed by the narrowed literal,
  // so a losing endpointKey entry fails here, not by silently emitting no base_url.
  const endpointKey =
    mp.provider === "custom" ||
    mp.provider === "openai" ||
    mp.provider === "anthropic" ||
    mp.provider === "elevenlabs"
      ? modelProviders[mp.provider].endpointKey
      : undefined;
  const registryBaseURL = endpointKey ? pickString(customKeys, endpointKey) : undefined;
  const baseURL =
    pickString(customKeys, "base_url") ?? pickString(customKeys, "BASE_URL") ?? registryBaseURL;
  const region = pickString(credentials, "region");
  const deploymentMap = mp.deploymentMapping
    ? (mp.deploymentMapping as Record<string, string>)
    : undefined;

  return {
    id: mp.id,
    slot: index === 0 ? "primary" : `fallback_${index}`,
    type: mp.provider,
    credentials,
    ...(baseURL ? { base_url: baseURL } : {}),
    ...(region ? { region } : {}),
    ...(deploymentMap ? { deployment_map: deploymentMap } : {}),
    ...routingWire({ mp, assembly }),
    config: buildProviderConfig(mp),
  };
}

/**
 * Routing half of a provider slot: the handle addressing this exact instance, and the models it declares served. Both absent (not empty) means nothing to say — read as "said nothing", not "serves nothing".
 */
function routingWire({
  mp,
  assembly,
}: {
  mp: ModelProvider;
  assembly: GatewayConfigAssemblyPort;
}): Pick<ProviderSlot, "handle" | "models"> {
  const models = assembly.declaredModelsForProvider(mp);

  return {
    ...(mp.routingHandle ? { handle: mp.routingHandle } : {}),
    ...(models ? { models } : {}),
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];

  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function buildProviderConfig(mp: ModelProvider): Record<string, unknown> {
  const gatewayExtras = (mp.providerConfig ?? {}) as Record<string, unknown>;

  return {
    rate_limit: {
      rpm: mp.rateLimitRpm,
      tpm: mp.rateLimitTpm,
      rpd: mp.rateLimitRpd,
    },
    health: {
      status: mp.healthStatus.toLowerCase(),
      circuit_opened_at: mp.circuitOpenedAt?.toISOString() ?? null,
    },
    ...(mp.extraHeaders ? { extra_headers: mp.extraHeaders as Record<string, unknown> } : {}),
    ...gatewayExtras,
  };
}

function scopeToWire(
  scope: GatewayBudget["scopeType"],
): GatewayConfigPayload["budgets"][number]["scope"] {
  switch (scope) {
    case "ORGANIZATION":
      return "organization";
    case "TEAM":
      return "team";
    case "PROJECT":
      return "project";
    case "VIRTUAL_KEY":
      return "virtual_key";
    case "PRINCIPAL":
      return "principal";
    case "GROUP":
      return "group";
    case "ATTRIBUTED_USER":
      return "attributed_user";
  }
}

function routingModeToWire(mode: VirtualKey["routingMode"]): GatewayConfigPayload["routing_mode"] {
  switch (mode) {
    case "NONE":
      return "none";
    case "FALLBACK_ALL":
      return "fallback_all";
    case "POLICY":
      return "policy";
  }
}

function providerExclusionWire(mp: ModelProvider): ProviderExclusionWire {
  return {
    id: mp.id,
    type: mp.provider,
    ...(mp.routingHandle ? { handle: mp.routingHandle } : {}),
  };
}

/**
 * Key's expiration as the gateway reads it: unix SECONDS (matching the vk_expires_at token claim), null if never — milliseconds would put the date tens of thousands of years out and lift the expiry cap off the key.
 */
function expiresAtWire(expiresAt: Date | null): number | null {
  return expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null;
}

/**
 * Splits scope-reachable providers the dispatch chain drops into the two reasons named at request time: routing policy dropped it (in access, not dispatchable), or provider access dropped it (outside the allowlist). A dispatching provider is in neither list.
 */
function providerExclusions({
  scopeReachable,
  eligibleProviders,
  allowed,
}: {
  scopeReachable: ModelProvider[];
  eligibleProviders: ModelProvider[];
  allowed: string[] | null;
}): { routingExcluded: ModelProvider[]; accessExcluded: ModelProvider[] } {
  const dispatchIds = new Set(eligibleProviders.map((mp) => mp.id));
  const routingExcluded = scopeReachable.filter(
    (mp) => (!allowed || allowed.includes(mp.id)) && !dispatchIds.has(mp.id),
  );
  const accessExcluded = allowed ? scopeReachable.filter((mp) => !allowed.includes(mp.id)) : [];

  return { routingExcluded, accessExcluded };
}

type BudgetWire = GatewayConfigPayload["budgets"][number];

/**
 * Current-period figure the bundle ships for one budget. Templates carry no aggregate (spend is per end-user bucket, fetched on demand); every other scope takes the CH rollup when loaded, falling back to the PG column when not.
 */
function budgetSpentMicroUSD(
  budget: GatewayBudgetResource,
  spendByBudgetId: Map<string, string>,
): number {
  if (budget.scopeType === "ATTRIBUTED_USER") {
    return 0;
  }

  const rollup = spendByBudgetId.get(budget.id);

  return rollup === undefined
    ? decimalToMicroUSD(budget.spentUsd)
    : decimalUSDStringToMicroUSD(rollup);
}

function budgetToWire(
  { budget: b, bucketScopeId, principalUserId }: GatewayResolvedBudget,
  spendByBudgetId: Map<string, string>,
): BudgetWire {
  return {
    id: b.id,
    scope: scopeToWire(b.scopeType),
    scope_id: bucketScopeId,
    ...(principalUserId ? { principal_id: principalUserId } : {}),
    ...(b.scopeType === "ATTRIBUTED_USER" ? { per_user: true as const } : {}),
    provider_key: b.providerKey,
    window: b.window.toLowerCase(),
    limit_micro_usd: decimalToMicroUSD(b.limitUsd),
    spent_micro_usd: budgetSpentMicroUSD(b, spendByBudgetId),
    // The boundary this budget is actually heading for, not the stored
    // column, which only moves at create and at an explicit reset.
    resets_at: Math.floor(effectiveBudgetPeriod(b).resetsAt.getTime() / 1000),
    on_breach: b.onBreach === "BLOCK" ? "block" : "warn",
  };
}

type CacheRuleWire = GatewayConfigPayload["cache_rules"][number];

function cacheRuleToWire(rule: GatewayCacheRuleResource): CacheRuleWire {
  return {
    id: rule.id,
    priority: rule.priority,
    matchers: rule.matchers,
    action: rule.action,
  };
}

function guardrailToWire(entry: GatewayGuardrailBundleEntry): GuardrailWire {
  return {
    id: entry.id,
    name: entry.name,
    evaluator_id: entry.evaluatorId,
    evaluator_slug: entry.evaluatorSlug,
    direction: entry.direction,
    failure_mode: entry.failureMode,
  };
}

function guardrailAttachmentToWire(
  attachment: GatewayConfigGuardrailAttachment,
): GuardrailAttachmentWire {
  return { direction: attachment.direction, guardrail_ids: attachment.guardrailIds };
}

/**
 * `GatewayMoney` is the contract's database-library-free decimal: it answers
 * its exact value as a string and nothing more, so the conversion goes through
 * the same string parse the ClickHouse rollup takes.
 */
function decimalToMicroUSD(d: GatewayMoney): number {
  return decimalUSDStringToMicroUSD(d.toString());
}

function decimalUSDStringToMicroUSD(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(n * 1_000_000);
}
