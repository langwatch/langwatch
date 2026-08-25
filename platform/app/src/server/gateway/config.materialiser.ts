/**
 * Materialise the payload returned from `GET /api/internal/gateway/config/:vk_id`.
 *
 * Bundle shape lives in contract §4.2. Source of truth changed in the
 * VK-binding collapse: GatewayProviderCredential is gone, ModelProvider
 * absorbed its advanced gateway fields, and the VK's eligible-provider
 * set is now computed from the VirtualKeyScope graph + an optional
 * RoutingPolicy.modelProviderIds ordering. See `scopeResolver.ts` for
 * the cascade walker.
 */
import type {
  GatewayBudget,
  GatewayCacheRule,
  ModelProvider,
  PrismaClient,
  VirtualKey,
} from "~/generated/prisma/client";

import { readCustomKeys } from "~/server/modelProviders/customKeys";
import { resolveLangyMirrorTier, type LangyMirrorTier } from "@langwatch/langy-contract";
import { modelProviders } from "../modelProviders/registry";
import type { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { budgetPeriodFloorMs, effectiveBudgetPeriod } from "./budgetPeriod";
import {
  type ResolvedBudget,
  resolveApplicableBudgets,
} from "./budgetResolution.service";
import { GatewayCacheRuleService } from "./cacheRule.service";
import { computeConfigETag } from "./configETag";
import { withTierFallthrough } from "./modelTierFallthrough";
import { declaredModelsForProvider } from "./providerModelCatalog";
import {
  eligibleModelProvidersForVk,
  scopeReachableModelProvidersForVk,
  traceProjectFor,
} from "./scopeResolver";
import { organizationSpendTenantIds } from "./spendTenants";
import { parseVirtualKeyConfig } from "./virtualKey.config";
import type { VirtualKeyWithScopes } from "./virtualKey.repository";

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
   * Opaque per-provider credentials blob. Shape matches what the Go
   * gateway's pcToBifrostKey expects for each provider type:
   * - OpenAI / Anthropic / Gemini / default: `{api_key}`
   * - Azure: `{api_key, endpoint, api_version?}`
   * - Bedrock: `{access_key, secret_key, session_token?, region?}`
   * - Vertex: `{project_id, project_number, region, auth_credentials}`
   * Decrypted from ModelProvider.customKeys (AES-256-GCM at rest).
   */
  credentials: Record<string, unknown>;
  base_url?: string;
  region?: string;
  deployment_map?: Record<string, string>;
  /**
   * The operator-chosen routing handle of this ModelProvider row. A caller
   * writes it where a provider family goes ("eu/claude-sonnet-5") to reach
   * THIS instance rather than whichever instance of the family the key's chain
   * order reaches first. Absent when the operator set none.
   */
  handle?: string;
  /**
   * What this provider declares it serves, for ROUTING a bare model name to
   * the provider that owns it. Absent when the row declares nothing, which the
   * gateway reads as "this provider said nothing" rather than "this provider
   * serves nothing". Authorization stays with `models_allowed`.
   */
  models?: string[];
  config: Record<string, unknown>;
};

/**
 * A ModelProvider row the gateway will not dispatch to, named so a
 * request-time block can say why. `type` is the provider kind (ModelProvider.provider),
 * carried alongside the row id because the gateway matches a resolved request
 * by provider kind and these rows are absent from `providers[]`.
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
   * project_id / project_otlp_token / team_id are populated when the VK
   * has a single PROJECT scope, or when the org has an
   * `internal_governance` project (TEAM/ORG-scoped VKs route traces
   * there so the AI Governance ingestion view shows VK + receiver spans
   * under one filter). Null for older self-hosted orgs without a
   * governance project — the gateway skips span export rather than
   * failing the config fetch.
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
   * Explicit provider allowlist. `null` means every provider the key can
   * reach through its scope graph, now and in the future, the semantic a
   * key gets when its creator ticks "All providers", so a provider added
   * next month is usable without editing the key. A list narrows to those
   * ModelProvider ids; `providers[]` is already filtered to match, and the
   * field ships so the gateway can surface WHY a model is unavailable.
   */
  providers_allowed: string[] | null;
  /**
   * How the key behaves when its provider fails. "none" = no failover
   * (the default for keys created after the routing-mode split);
   * "fallback_all" = walk every eligible provider; "policy" = the linked
   * RoutingPolicy decides.
   */
  routing_mode: "none" | "fallback_all" | "policy";
  /**
   * Contract §4.2. Providers a request could resolve to but the gateway will
   * NOT dispatch to, split by WHY, so a request-time block can name the
   * reason instead of failing opaque. Each entry is a ModelProvider row id
   * plus its provider type, the same `{id, type}` shape `providers[]` carries,
   * because the gateway matches the provider a request resolved to by TYPE and
   * these rows are absent from `providers[]`.
   *
   * routing_excluded_providers: reachable from the key's scope AND inside its
   * provider access, but dropped by the routing policy (named by
   * routing_policy_name). access_excluded_providers: reachable from scope but
   * outside providers_allowed (empty when the key allows all providers). A
   * provider in neither list and absent from `providers[]` is not reachable
   * from the key's scope at all.
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
     * Only set for "attributed_user": the entry is a TEMPLATE ("each
     * distinct end user on this anchor: this limit per window"). scope_id
     * stays the ANCHOR; per-user spend is unbounded-cardinality and never
     * materialises here, the gateway fetches the request's bucket through
     * its cached bucket-spend read. spent_micro_usd is 0 on templates.
     */
    per_user?: true;
    /**
     * Provider filter. Null = the budget counts every dispatch; set = it
     * counts and constrains only dispatches to that ModelProvider id, so a
     * breach removes that provider from the chain instead of blocking the
     * whole request.
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
   * ADR-061 mirror tier. Present and non-skip ONLY for Langy virtual keys, so
   * the gateway never mirrors ordinary customer traffic. The gateway reads this
   * (never a client header) to decide whether to duplicate the gen_ai span into
   * the mirror project.
   */
  langy_mirror_tier: LangyMirrorTier;
  metadata: Record<string, unknown>;
  // The VK's operator-assigned tags, lifted from config.metadata.tags.
  // The gateway stamps them on customer spans as langwatch.labels (Trace
  // Explorer "Label" filter) and matches cache-rule vk_tags against them.
  vk_tags: string[];
  /**
   * The date the key stops serving, in unix seconds, and `null` for a key that
   * never expires. Always present, because the gateway tells an explicit null
   * ("this key has no date") apart from a field a control plane older than it
   * never sent ("keep the date you already hold").
   *
   * The key's expiry also travels on the auth token as `vk_expires_at`, which
   * is the mint-time floor. Carrying it here as well is what bounds how long
   * the gateway can hold an out-of-date value: the ETag moves on every
   * mutation, so a shortened or extended date reaches the gateway on its next
   * config revalidation even while the change feed is unavailable.
   */
  expires_at: number | null;
};

export class GatewayConfigMaterialiser {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chRepo: GatewayBudgetClickHouseRepository | null = null,
  ) {}

  /**
   * The providers this key dispatches to, plus the three wire fields that let
   * the gateway name why a resolved provider was not used. An explicit allowlist
   * narrows dispatch; absence means every scope-reachable provider, now and
   * later, so the filter runs here rather than being frozen into stored scope
   * rows. `eligibleProviders` is already routing-policy-applied, so the
   * scope-reachable set minus dispatch is what the policy dropped, and the
   * allowlist complement is what provider access dropped.
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
    const scopeReachable = await scopeReachableModelProvidersForVk(this.prisma, vk);
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
   * The version token for the bundle this materialiser would build for `vk`.
   *
   * It lives beside `materialise` because it describes that output: the token
   * has to move whenever the bundle would come back different, and the two
   * drifting apart is what lets a 304 confirm a bundle that is no longer
   * current. See `configETag.ts` for what it covers and what it leaves to the
   * change feed.
   */
  async versionToken(vk: VirtualKeyWithScopes): Promise<string> {
    return await computeConfigETag({ prisma: this.prisma, virtualKey: vk });
  }

  async materialise(vk: VirtualKeyWithScopes): Promise<GatewayConfigPayload> {
    const eligibleProviders = await eligibleModelProvidersForVk(this.prisma, vk);
    const traceProject = await traceProjectFor(this.prisma, vk.traceProjectId);
    const budgets = await this.applicableBudgets(vk, traceProject);
    const spendByBudgetId = await this.loadCurrentSpend(vk, budgets);
    const cacheRules = await this.applicableCacheRules(vk.organizationId);
    const config = parseVirtualKeyConfig(vk.config);
    const { providers, exclusions } = await this.dispatchAndExclusions(
      vk,
      eligibleProviders,
      config.providersAllowed,
    );
    const policySides = resolvePolicySideOfBundle(vk, config);
    const guardrailSides = await this.resolveGuardrailSideOfBundle(
      vk,
      config,
      traceProject,
    );

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
          ? resolveLangyMirrorTier({ projectId: traceProject.id }, process.env)
          : "skip",
      providers: providers.map((mp, index) => buildProviderSlot(mp, index)),
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
      guardrails: guardrailSides.guardrails,
      guardrail_attachments: guardrailSides.attachments,
      policy_rules: policySides.policyRules,
      rate_limits: {
        rpm: config.rateLimits.rpm,
        tpm: config.rateLimits.tpm,
        rpd: config.rateLimits.rpd,
      },
      budgets: budgets.map((resolved) => budgetToWire(resolved, spendByBudgetId)),
      cache_rules: cacheRules.map(cacheRuleToWire),
      metadata: config.metadata ?? {},
      vk_tags: config.metadata?.tags ?? [],
      expires_at: expiresAtWire(vk.expiresAt),
    };
  }

  private async applicableCacheRules(
    organizationId: string,
  ): Promise<GatewayCacheRule[]> {
    return GatewayCacheRuleService.create(this.prisma).bundleFor(organizationId);
  }

  /**
   * Project-scoped guardrails the gateway is allowed to invoke for this
   * VK + the VK's attachment tuples. GatewayGuardrail is project-scoped
   * so the flat catalog is fetched against the VK's resolved trace
   * project. VKs without a trace project (ORG/TEAM-scoped without
   * internal_governance fallback) cannot invoke any guardrail; both
   * arrays come back empty in that case.
   */
  private async resolveGuardrailSideOfBundle(
    vk: VirtualKeyWithScopes,
    config: ReturnType<typeof parseVirtualKeyConfig>,
    traceProject: { id: string; teamId: string } | null,
  ): Promise<{
    guardrails: GuardrailWire[];
    attachments: GuardrailAttachmentWire[];
  }> {
    if (!traceProject) {
      return { guardrails: [], attachments: [] };
    }
    const rows = await this.prisma.gatewayGuardrail.findMany({
      where: { projectId: traceProject.id, archivedAt: null },
      include: { evaluator: { select: { slug: true } } },
    });
    const guardrails: GuardrailWire[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      evaluator_id: r.evaluatorId,
      evaluator_slug: r.evaluator?.slug ?? null,
      direction:
        r.direction === "PRE" ? "pre" : r.direction === "POST" ? "post" : "stream_chunk",
      failure_mode: r.failureMode === "FAIL_OPEN" ? "fail_open" : "fail_closed",
    }));
    const guardrailIdSet = new Set(rows.map((r) => r.id));
    // Drop attachment references to guardrails that no longer exist or
    // belong to a different project; the gateway should never see a
    // dangling id.
    const attachments: GuardrailAttachmentWire[] = config.guardrailAttachments
      .map((a) => ({
        direction: a.direction,
        guardrail_ids: a.guardrailIds.filter((id) => guardrailIdSet.has(id)),
      }))
      .filter((a) => a.guardrail_ids.length > 0);
    return { guardrails, attachments };
  }

  /**
   * CH spend rollup. Best-effort: falls back to PG `spentUsd` when CH
   * isn't wired (test fixtures, deploys without CH). Tenant set = every
   * project under the VK's organization so ORG/TEAM/PRINCIPAL-scoped
   * budgets see ledger rows under whichever project emitted the trace.
   */
  private async loadCurrentSpend(
    vk: VirtualKey,
    budgets: ResolvedBudget[],
  ): Promise<Map<string, string>> {
    if (this.chRepo === null || budgets.length === 0) {
      return new Map();
    }
    try {
      const tenantIds = await organizationSpendTenantIds(this.prisma, vk.organizationId);
      if (tenantIds.length === 0) return new Map();
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
   * Every budget that applies to this VK. ORG-scope + VK-scope always
   * apply; TEAM/PROJECT-scope only when a trace project resolves
   * (single-project-scope VK or governance fallback); PRINCIPAL and
   * per-member GROUP only when the key carries a principal. The scope
   * semantics live in the shared resolver, which the request-time check
   * and the debits process also call, so the bundle can never disagree
   * with what they pick.
   */
  private async applicableBudgets(
    vk: VirtualKey,
    traceProject: { id: string; teamId: string } | null,
  ): Promise<ResolvedBudget[]> {
    return resolveApplicableBudgets({
      client: this.prisma,
      target: {
        organizationId: vk.organizationId,
        virtualKeyId: vk.id,
        teamId: traceProject?.teamId ?? null,
        projectId: traceProject?.id ?? null,
        principalUserId: vk.principalUserId,
      },
    });
  }
}

// Resolve the policy-side of the bundle (model aliases + policy rules)
// from the VK's RoutingPolicy when present, falling back to the VK
// config defaults otherwise. Post-bug-7 step (iv) the legacy VK config
// keys are stripped so the fallback is always the empty default shape;
// the RP read becomes the source of truth as soon as the VK has a
// routingPolicyId pointing at a populated policy.
//
// Empty-rules normalize: the DB columns can hold `{}` (default at
// creation time) but the bundle wire shape is contracted at
// `{tools:{deny:[],allow:null}, mcp:..., urls:..., models:...}`.
// Materialise the wire-correct shape regardless of DB content so the Go
// resolver gets a stable structure (ariana R-lane CR pin from step (i)).
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
  if (!raw || typeof raw !== "object") return { ...EMPTY_POLICY_RULE_DIM };
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
  if (!raw || typeof raw !== "object") return emptyPolicyRules();
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
    modelAliases: withTierFallthrough({
      aliases,
      defaultModel: rp.defaultModel,
    }),
    policyRules: normalisePolicyRules(rp.policyRules),
  };
}

// Map ModelProvider.customKeys (env-var-style UPPER_SNAKE_CASE inherited
// from the LiteLLM integration) to the Go gateway's per-provider
// credential shape. See services/aigateway/internal/dispatch/account.go
// #pcToBifrostKey for the consuming side.
// Exported for tests: the per-provider credential shapes (which fields ride
// with which provider, e.g. gemini's optional Agent Platform pair) are
// contract, and this is the single place they are built.
// One provider, two Google doors. A credential carrying a project and
// location is an Agent Platform key: the Go gateway routes it to
// aiplatform.googleapis.com at the path those two fields name, while a
// bare key goes to the Gemini API. See
// specs/model-providers/google-agent-platform.feature.
function geminiCredentials(pick: (k: string) => string): Record<string, unknown> {
  // Trimmed here as well as at the schema: rows stored before the schema
  // trimmed could carry whitespace, and a whitespace-only "pair" must not
  // pick the Agent Platform door.
  const project = pick("GEMINI_PROJECT").trim();
  const location = pick("GEMINI_LOCATION").trim();
  return {
    api_key: pick("GEMINI_API_KEY") || pick("GOOGLE_API_KEY"),
    ...(project && location
      ? {
          project_id: project,
          // `region`, not `location`: `buildProviderSlot` lifts a
          // slot-level region by looking up exactly that key
          // (`pickString(credentials, "region")`), the convention every
          // other regional provider's credentials already follow. Naming
          // it `location` here — Google's own term, kept as the
          // customer-facing field name — would silently leave this
          // credential without a slot-level region once something reads
          // it.
          region: location,
        }
      : {}),
  };
}

export function buildCredentials(mp: ModelProvider): Record<string, unknown> {
  const provider = mp.provider;
  const customKeys = readCustomKeys(mp.customKeys).keys;
  const pick = (k: string): string =>
    typeof customKeys[k] === "string" ? (customKeys[k] as string) : "";

  switch (provider) {
    case "azure": {
      return {
        api_key: pick("AZURE_OPENAI_API_KEY") || pick("api-key"),
        endpoint: pick("AZURE_OPENAI_ENDPOINT") || pick("AZURE_API_GATEWAY_BASE_URL"),
        api_version:
          pick("AZURE_OPENAI_API_VERSION") || pick("AZURE_API_GATEWAY_VERSION"),
      };
    }
    case "bedrock": {
      return {
        access_key: pick("AWS_ACCESS_KEY_ID"),
        secret_key: pick("AWS_SECRET_ACCESS_KEY"),
        session_token: pick("AWS_SESSION_TOKEN"),
        region: pick("AWS_REGION_NAME") || pick("AWS_REGION"),
      };
    }
    case "vertex_ai":
    case "vertex": {
      return {
        project_id: pick("VERTEXAI_PROJECT") || pick("GOOGLE_PROJECT_ID"),
        project_number: pick("VERTEXAI_PROJECT_NUMBER"),
        region: pick("VERTEXAI_LOCATION") || pick("GOOGLE_REGION"),
        auth_credentials:
          pick("GOOGLE_APPLICATION_CREDENTIALS") || pick("VERTEXAI_SERVICE_ACCOUNT_JSON"),
      };
    }
    case "openai_codex": {
      // OAuth session, not an API key: the gateway sends the access token as
      // the bearer and the ChatGPT account id as a header, and calls back to
      // the control plane (by row id) to refresh a 401'd token once. See
      // services/aigateway codex dispatch + /api/gateway/internal codex
      // refresh route.
      return {
        access_token: pick("CODEX_ACCESS_TOKEN"),
        account_id: pick("CODEX_ACCOUNT_ID"),
        provider_row_id: mp.id,
      };
    }
    case "anthropic":
      return { api_key: pick("ANTHROPIC_API_KEY") };
    case "gemini":
    case "google_gemini":
      return geminiCredentials(pick);
    // Fold-window compatibility: rows stored while Agent Platform was its
    // own provider carry the retired field names. Same wire shape as a
    // gemini credential naming the Agent Platform door; goes with the
    // deprecated registry entry and is deleted after the migration runs.
    case "google_agent_platform":
      return {
        api_key: pick("GOOGLE_AGENT_PLATFORM_API_KEY"),
        project_id: pick("GOOGLE_AGENT_PLATFORM_PROJECT").trim(),
        region: pick("GOOGLE_AGENT_PLATFORM_LOCATION").trim(),
      };
    case "openai":
      return { api_key: pick("OPENAI_API_KEY") };
    case "deepseek":
      return { api_key: pick("DEEPSEEK_API_KEY") };
    case "xai":
      return { api_key: pick("XAI_API_KEY") };
    case "cerebras":
      return { api_key: pick("CEREBRAS_API_KEY") };
    case "groq":
      return { api_key: pick("GROQ_API_KEY") };
    case "cloudflare":
      return { api_key: pick("CLOUDFLARE_API_KEY") };
    default: {
      const apiKey = Object.entries(customKeys).find(([k]) => /_API_KEY$/.test(k))?.[1];
      return { api_key: typeof apiKey === "string" ? apiKey : "" };
    }
  }
}

function buildProviderSlot(mp: ModelProvider, index: number): ProviderSlot {
  const credentials = buildCredentials(mp);
  const customKeys = readCustomKeys(mp.customKeys).keys;
  // Providers whose base-URL override the gateway consumes (see mapProvider
  // in bifrost.go): "custom" and "openai" route it to Bifrost's VLLM
  // (OpenAI-compat) adapter; "anthropic" derives a per-endpoint custom
  // provider so /v1/messages reaches self-hosted Anthropic-compatible
  // servers (vLLM >= 0.24) instead of api.anthropic.com. Other providers
  // with an endpointKey resolve their endpoint elsewhere (Azure/Vertex via
  // credentials.endpoint), so emitting a per-slot base_url for them would
  // be a dead field. Scope the override to what's consumed.
  // "elevenlabs" is on the list for the realtime session mint, which dials
  // the vendor directly and must reach the residency host the customer
  // chose: a signed URL minted against the default host is signed in the
  // wrong region.
  const supportsBaseURLOverride =
    mp.provider === "custom" ||
    mp.provider === "openai" ||
    mp.provider === "anthropic" ||
    mp.provider === "elevenlabs";
  const endpointKey = supportsBaseURLOverride
    ? modelProviders[mp.provider as keyof typeof modelProviders]?.endpointKey
    : undefined;
  const registryBaseURL = endpointKey ? pickString(customKeys, endpointKey) : undefined;
  const baseURL =
    pickString(customKeys, "base_url") ??
    pickString(customKeys, "BASE_URL") ??
    registryBaseURL;
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
    ...routingWire({ mp }),
    config: buildProviderConfig(mp),
  };
}

/**
 * The routing half of a provider slot: the handle that addresses this exact
 * instance, and the models it declares it serves. Both are absent rather than
 * empty when there is nothing to say, which is what the gateway reads as "this
 * provider said nothing" instead of "this provider serves nothing".
 */
function routingWire({
  mp,
}: {
  mp: ModelProvider;
}): Pick<ProviderSlot, "handle" | "models"> {
  const models = declaredModelsForProvider(mp);
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
    ...(mp.extraHeaders
      ? { extra_headers: mp.extraHeaders as Record<string, unknown> }
      : {}),
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

function routingModeToWire(
  mode: VirtualKey["routingMode"],
): GatewayConfigPayload["routing_mode"] {
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
 * The key's expiration date as the gateway reads it: unix SECONDS, and null for
 * a key that never expires. Seconds because the gateway decodes the field as a
 * unix timestamp, the same unit the `vk_expires_at` token claim uses;
 * milliseconds would put the date tens of thousands of years out and lift the
 * expiry cap off the key.
 */
function expiresAtWire(expiresAt: Date | null): number | null {
  return expiresAt ? Math.floor(expiresAt.getTime() / 1000) : null;
}

/**
 * Splits the scope-reachable providers the dispatch chain drops into the two
 * reasons the gateway names at request time: the routing policy dropped it
 * (inside provider access, but not dispatchable), or provider access dropped it
 * (outside the allowlist). A provider that dispatches is in neither list.
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
  const accessExcluded = allowed
    ? scopeReachable.filter((mp) => !allowed.includes(mp.id))
    : [];
  return { routingExcluded, accessExcluded };
}

type BudgetWire = GatewayConfigPayload["budgets"][number];

/**
 * The current-period figure the bundle ships for one budget. Templates carry
 * no aggregate: spend is per end-user bucket and the gateway fetches the
 * request's bucket on demand. Every other scope takes the CH rollup when it
 * was loaded, falling back to the PG column when it was not.
 */
function budgetSpentMicroUSD(
  budget: GatewayBudget,
  spendByBudgetId: Map<string, string>,
): number {
  if (budget.scopeType === "ATTRIBUTED_USER") return 0;
  const rollup = spendByBudgetId.get(budget.id);
  return rollup === undefined
    ? decimalToMicroUSD(budget.spentUsd)
    : decimalUSDStringToMicroUSD(rollup);
}

function budgetToWire(
  { budget: b, bucketScopeId, principalUserId }: ResolvedBudget,
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

function cacheRuleToWire(rule: GatewayCacheRule): CacheRuleWire {
  const matchers = rule.matchers as CacheRuleWire["matchers"];
  const action = rule.action as CacheRuleWire["action"];
  return {
    id: rule.id,
    priority: rule.priority,
    matchers,
    action,
  };
}

function decimalToMicroUSD(d: { toNumber(): number }): number {
  return Math.round(d.toNumber() * 1_000_000);
}

function decimalUSDStringToMicroUSD(s: string): number {
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1_000_000);
}
