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
  Prisma,
  PrismaClient,
  VirtualKey,
} from "@prisma/client";

import { decrypt } from "../../utils/encryption";
import { modelProviders } from "../modelProviders/registry";
import { GatewayBudgetClickHouseRepository } from "./budget.clickhouse.repository";
import { GatewayCacheRuleService } from "./cacheRule.service";
import {
  eligibleModelProvidersForVk,
  resolveTraceProject,
} from "./scopeResolver";
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
  config: Record<string, unknown>;
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
  fallback: {
    on: string[];
    chain: string[];
    timeout_ms: number;
    max_attempts: number;
  };
  model_aliases: Record<string, string>;
  models_allowed: string[] | null;
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
    scope: "organization" | "team" | "project" | "virtual_key" | "principal";
    scope_id: string;
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
  metadata: Record<string, unknown>;
};

export class GatewayConfigMaterialiser {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly chRepo: GatewayBudgetClickHouseRepository | null = null,
  ) {}

  async materialise(vk: VirtualKeyWithScopes): Promise<GatewayConfigPayload> {
    const providers = await eligibleModelProvidersForVk(this.prisma, vk);
    const traceProject = await resolveTraceProject(this.prisma, vk);
    const budgets = await this.applicableBudgets(vk, traceProject);
    const spendByBudgetId = await this.loadCurrentSpend(vk, budgets);
    const cacheRules = await this.applicableCacheRules(vk.organizationId);
    const config = parseVirtualKeyConfig(vk.config);
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
      providers: providers.map((mp, index) => buildProviderSlot(mp, index)),
      fallback: {
        on: config.fallback.on,
        chain: providers.map((mp) => mp.id),
        timeout_ms: config.fallback.timeoutMs,
        max_attempts: config.fallback.maxAttempts,
      },
      model_aliases: policySides.modelAliases,
      models_allowed: config.modelsAllowed,
      cache: { mode: config.cache.mode, ttl_s: config.cache.ttlS },
      guardrails: guardrailSides.guardrails,
      guardrail_attachments: guardrailSides.attachments,
      policy_rules: policySides.policyRules,
      rate_limits: {
        rpm: config.rateLimits.rpm,
        tpm: config.rateLimits.tpm,
        rpd: config.rateLimits.rpd,
      },
      budgets: budgets.map((b) => ({
        id: b.id,
        scope: scopeToWire(b.scopeType),
        scope_id: b.scopeId,
        window: b.window.toLowerCase(),
        limit_micro_usd: decimalToMicroUSD(b.limitUsd),
        spent_micro_usd: spendByBudgetId.has(b.id)
          ? decimalUSDStringToMicroUSD(spendByBudgetId.get(b.id)!)
          : decimalToMicroUSD(b.spentUsd),
        resets_at: Math.floor(b.resetsAt.getTime() / 1000),
        on_breach: b.onBreach === "BLOCK" ? "block" : "warn",
      })),
      cache_rules: cacheRules.map(cacheRuleToWire),
      metadata: config.metadata ?? {},
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
        r.direction === "PRE"
          ? "pre"
          : r.direction === "POST"
            ? "post"
            : "stream_chunk",
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
    budgets: GatewayBudget[],
  ): Promise<Map<string, string>> {
    if (this.chRepo === null || budgets.length === 0) {
      return new Map();
    }
    try {
      const orgProjects = await this.prisma.project.findMany({
        where: { team: { organizationId: vk.organizationId } },
        select: { id: true },
      });
      const tenantIds = orgProjects.map((p) => p.id);
      if (tenantIds.length === 0) return new Map();
      const spends = await this.chRepo.getSpendForBudgetsAcrossTenants(
        tenantIds,
        budgets,
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
   * apply. TEAM/PROJECT-scope apply only when a trace project resolves
   * (single-project-scope VK or governance fallback).
   */
  private async applicableBudgets(
    vk: VirtualKey,
    traceProject: { id: string; teamId: string } | null,
  ): Promise<GatewayBudget[]> {
    const ors: NonNullable<Prisma.GatewayBudgetWhereInput["OR"]> = [
      { scopeType: "ORGANIZATION", scopeId: vk.organizationId },
      { scopeType: "VIRTUAL_KEY", scopeId: vk.id },
    ];
    if (traceProject) {
      ors.push({ scopeType: "TEAM", scopeId: traceProject.teamId });
      ors.push({ scopeType: "PROJECT", scopeId: traceProject.id });
    }
    if (vk.principalUserId) {
      ors.push({ scopeType: "PRINCIPAL", scopeId: vk.principalUserId });
    }
    return this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: vk.organizationId,
        archivedAt: null,
        OR: ors,
      },
    });
  }
}

function decryptCustomKeys(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  if (typeof raw === "string") {
    try {
      return JSON.parse(decrypt(raw)) as Record<string, unknown>;
    } catch {
      return {};
    }
  }
  return {};
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

const EMPTY_POLICY_RULE_DIM = { deny: [] as string[], allow: null as string[] | null };

function emptyPolicyRules(): BundlePolicyRules {
  return {
    tools: { ...EMPTY_POLICY_RULE_DIM },
    mcp: { ...EMPTY_POLICY_RULE_DIM },
    urls: { ...EMPTY_POLICY_RULE_DIM },
    models: { ...EMPTY_POLICY_RULE_DIM },
  };
}

function mergePolicyDim(
  raw: unknown,
): { deny: string[]; allow: string[] | null } {
  if (!raw || typeof raw !== "object") return { ...EMPTY_POLICY_RULE_DIM };
  const r = raw as { deny?: unknown; allow?: unknown };
  const deny = Array.isArray(r.deny) ? r.deny.filter((x): x is string => typeof x === "string") : [];
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
    modelAliases: aliases,
    policyRules: normalisePolicyRules(rp.policyRules),
  };
}

// Map ModelProvider.customKeys (env-var-style UPPER_SNAKE_CASE inherited
// from the LiteLLM integration) to the Go gateway's per-provider
// credential shape. See services/aigateway/internal/dispatch/account.go
// #pcToBifrostKey for the consuming side.
function buildCredentials(mp: ModelProvider): Record<string, unknown> {
  const provider = mp.provider;
  const customKeys = decryptCustomKeys(mp.customKeys);
  const pick = (k: string): string =>
    typeof customKeys[k] === "string" ? (customKeys[k] as string) : "";

  switch (provider) {
    case "azure": {
      return {
        api_key: pick("AZURE_OPENAI_API_KEY") || pick("api-key"),
        endpoint:
          pick("AZURE_OPENAI_ENDPOINT") ||
          pick("AZURE_API_GATEWAY_BASE_URL"),
        api_version:
          pick("AZURE_OPENAI_API_VERSION") ||
          pick("AZURE_API_GATEWAY_VERSION"),
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
          pick("GOOGLE_APPLICATION_CREDENTIALS") ||
          pick("VERTEXAI_SERVICE_ACCOUNT_JSON"),
      };
    }
    case "anthropic":
      return { api_key: pick("ANTHROPIC_API_KEY") };
    case "gemini":
    case "google_gemini":
      return { api_key: pick("GEMINI_API_KEY") || pick("GOOGLE_API_KEY") };
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
      const apiKey = Object.entries(customKeys).find(([k]) =>
        /_API_KEY$/.test(k),
      )?.[1];
      return { api_key: typeof apiKey === "string" ? apiKey : "" };
    }
  }
}

function buildProviderSlot(mp: ModelProvider, index: number): ProviderSlot {
  const credentials = buildCredentials(mp);
  const customKeys = decryptCustomKeys(mp.customKeys);
  // Only "custom" and "openai" route a base-URL override to Bifrost's VLLM
  // adapter (see mapProvider in bifrost.go), the sole consumer of the
  // per-slot base_url. Other providers with an endpointKey resolve their
  // endpoint elsewhere (Azure/Vertex via credentials.endpoint, Anthropic via
  // Bifrost's provider-level network_config), so emitting a per-slot base_url
  // for them would be a dead field. Scope the override to what's consumed;
  // this is what lets an "openai" provider with OPENAI_BASE_URL reach a
  // self-hosted proxy instead of api.openai.com.
  const supportsBaseURLOverride =
    mp.provider === "custom" || mp.provider === "openai";
  const endpointKey = supportsBaseURLOverride
    ? modelProviders[mp.provider as keyof typeof modelProviders]?.endpointKey
    : undefined;
  const registryBaseURL = endpointKey
    ? pickString(customKeys, endpointKey)
    : undefined;
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
    config: buildProviderConfig(mp),
  };
}

function pickString(
  obj: Record<string, unknown>,
  key: string,
): string | undefined {
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
  scope:
    | "ORGANIZATION"
    | "TEAM"
    | "PROJECT"
    | "VIRTUAL_KEY"
    | "PRINCIPAL",
): "organization" | "team" | "project" | "virtual_key" | "principal" {
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
  }
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
