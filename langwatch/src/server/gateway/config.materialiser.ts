/**
 * Materialise the payload returned from `GET /api/internal/gateway/config/:vk_id`.
 *
 * Shape: contract §4.2. Caller loads the VirtualKey + its provider chain and
 * hands off to this module; we collect applicable budgets, normalise enums,
 * and assemble the JSON blob the Go gateway expects.
 */
import type {
  GatewayBudget,
  GatewayCacheRule,
  GatewayProviderCredential,
  ModelProvider,
  PrismaClient,
  Project,
  Team,
  VirtualKey,
} from "@prisma/client";

import { decrypt } from "../../utils/encryption";
import { GatewayCacheRuleService } from "./cacheRule.service";
import { parseVirtualKeyConfig } from "./virtualKey.config";
import type { VirtualKeyWithChain } from "./virtualKey.repository";

export type ProviderSlot = {
  // `id` is the per-org-unique provider credential identifier the Go
  // gateway keys on (auth.ProviderCred.ID, json:"id"). Was historically
  // emitted as `credentials_ref` for the resolve-later opaque-ref model
  // that never shipped; renamed in contract §4.2 to match wire reality.
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
   * Finding #26 fix: without this field the gateway surfaces
   * "no keys found for provider: <name>" on every /v1/* request.
   */
  credentials: Record<string, unknown>;
  // Promoted out of `config` per contract §4.2 so Go-side ProviderCred
  // can unmarshal directly into its top-level fields. Omitted when
  // unset so the JSON remains terse.
  base_url?: string;
  region?: string;
  deployment_map?: Record<string, string>;
  config: Record<string, unknown>;
};

export type GatewayConfigPayload = {
  revision: string; // serialised bigint
  vk_id: string;
  status: "active" | "revoked";
  display_prefix: string;
  environment: "live" | "test";
  organization_id: string;
  project_id: string;
  /**
   * Project API key the gateway uses as X-Auth-Token on OTLP span
   * export so spans land in this VK's project's inbox. Not a new
   * secret — same apiKey already authenticates /api/collector.
   */
  project_otlp_token: string;
  team_id: string;
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
  guardrails: {
    pre: { id: string; evaluator: string }[];
    post: { id: string; evaluator: string }[];
    stream_chunk: { id: string; evaluator: string }[];
    request_fail_open: boolean;
    response_fail_open: boolean;
  };
  blocked_patterns: {
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
    limit_usd: string; // Decimal rendered as string for JSON fidelity
    spent_usd: string;
    remaining_usd: string;
    /**
     * Unix seconds (number). Must match the Go gateway's BudgetSpec.
     * ResetsAt (int64) — previously emitted as ISO 8601 string here,
     * which failed JSON decode on the Go side and cascaded into a
     * "no VK config loaded" 400 on every dispatch against a VK with
     * reachable budgets (finding #30 follow-up).
     */
    resets_at: number;
    on_breach: "block" | "warn";
  }>;
  // Cache-control rules pre-sorted by priority DESC, enabled-only.
  // The gateway evaluates them first-match-wins in a linear scan on every
  // request; the bundle-baked shape preserves the ~700 ns hot path (see
  // specs/ai-gateway/cache-control-rules.feature §4).
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

type ProviderRow = GatewayProviderCredential & { modelProvider: ModelProvider };

export class GatewayConfigMaterialiser {
  constructor(private readonly prisma: PrismaClient) {}

  async materialise(vk: VirtualKeyWithChain): Promise<GatewayConfigPayload> {
    const project = await this.requireProject(vk.projectId);
    const chain = await this.loadProviderChain(vk);
    const budgets = await this.applicableBudgets(vk, project);
    const cacheRules = await this.applicableCacheRules(
      project.team.organizationId,
    );
    const config = parseVirtualKeyConfig(vk.config);

    return {
      revision: vk.revision.toString(),
      vk_id: vk.id,
      status: vk.status === "ACTIVE" ? "active" : "revoked",
      display_prefix: vk.displayPrefix,
      environment: vk.environment === "LIVE" ? "live" : "test",
      organization_id: project.team.organizationId,
      project_id: project.id,
      // project_otlp_token lets the gateway authenticate span export to
      // /api/otel on behalf of this project. The control-plane OTLP
      // ingest authenticates exactly like /api/collector — per-project
      // API token on X-Auth-Token — so using the project's apiKey here
      // makes spans land in the VK's project's inbox (rchaves iter-66
      // "traces not landing" ask). Bundles already travel inside the
      // HMAC-signed internal gateway channel, so no new secret boundary.
      project_otlp_token: project.apiKey,
      team_id: project.teamId,
      principal_id: vk.principalUserId,
      providers: chain.map((row, index) => buildProviderSlot(row, index)),
      fallback: {
        on: config.fallback.on,
        chain: chain.map((row) => row.id),
        timeout_ms: config.fallback.timeoutMs,
        max_attempts: config.fallback.maxAttempts,
      },
      model_aliases: config.modelAliases,
      models_allowed: config.modelsAllowed,
      cache: { mode: config.cache.mode, ttl_s: config.cache.ttlS },
      guardrails: {
        pre: config.guardrails.pre,
        post: config.guardrails.post,
        stream_chunk: config.guardrails.streamChunk,
        request_fail_open: config.guardrails.requestFailOpen,
        response_fail_open: config.guardrails.responseFailOpen,
      },
      blocked_patterns: {
        tools: config.blockedPatterns.tools,
        mcp: config.blockedPatterns.mcp,
        urls: config.blockedPatterns.urls,
        models: config.blockedPatterns.models,
      },
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
        limit_usd: b.limitUsd.toString(),
        spent_usd: b.spentUsd.toString(),
        remaining_usd: subtract(b.limitUsd.toString(), b.spentUsd.toString()),
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

  private async requireProject(
    projectId: string,
  ): Promise<Project & { team: Team }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { team: true },
    });
    if (!project) throw new Error(`project ${projectId} not found`);
    return project;
  }

  private async loadProviderChain(
    vk: VirtualKeyWithChain,
  ): Promise<ProviderRow[]> {
    if (vk.providerCredentials.length === 0) return [];
    // projectId is threaded through so the multitenancy middleware's
    // guard is satisfied without adding GatewayProviderCredential to
    // EXEMPT_MODELS. The VK we were handed was already tenancy-checked
    // upstream, so we narrow the projectId to vk.projectId explicitly.
    const rows = await this.prisma.gatewayProviderCredential.findMany({
      where: {
        projectId: vk.projectId,
        id: { in: vk.providerCredentials.map((p) => p.providerCredentialId) },
      },
      include: { modelProvider: true },
    });
    // Preserve the chain ordering declared on the VK.
    const byId = new Map(rows.map((r) => [r.id, r]));
    return vk.providerCredentials
      .map((p) => byId.get(p.providerCredentialId))
      .filter((r): r is ProviderRow => Boolean(r));
  }

  private async applicableBudgets(
    vk: VirtualKey,
    project: Project & { team: Team },
  ): Promise<GatewayBudget[]> {
    return this.prisma.gatewayBudget.findMany({
      where: {
        organizationId: project.team.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: project.team.organizationId },
          { scopeType: "TEAM", scopeId: project.teamId },
          { scopeType: "PROJECT", scopeId: project.id },
          { scopeType: "VIRTUAL_KEY", scopeId: vk.id },
          vk.principalUserId
            ? { scopeType: "PRINCIPAL", scopeId: vk.principalUserId }
            : { id: "__never__" },
        ],
      },
    });
  }
}

// decryptCustomKeys turns ModelProvider.customKeys (AES-256-GCM
// encrypted string, legacy plaintext objects accepted for back-compat)
// into a plain key/value map. Mirrors
// modelProvider.repository.ts#decryptCustomKeys.
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

// buildCredentials maps ModelProvider.customKeys (historical env-var-
// style UPPER_SNAKE_CASE keys inherited from LiteLLM integration) to
// the Go gateway's per-provider credential shape. See
// services/gateway/internal/dispatch/account.go#pcToBifrostKey for the
// consuming side.
function buildCredentials(row: ProviderRow): Record<string, unknown> {
  const provider = row.modelProvider.provider;
  const customKeys = decryptCustomKeys(row.modelProvider.customKeys);
  const pick = (k: string): string =>
    typeof customKeys[k] === "string" ? (customKeys[k] as string) : "";

  switch (provider) {
    case "azure": {
      return {
        api_key: pick("AZURE_OPENAI_API_KEY") || pick("api-key"),
        endpoint: pick("AZURE_OPENAI_ENDPOINT") || pick("AZURE_API_GATEWAY_BASE_URL"),
        api_version: pick("AZURE_OPENAI_API_VERSION") || pick("AZURE_API_GATEWAY_VERSION"),
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
      // Fallback: first UPPER_CASE_KEY ending in _API_KEY.
      const apiKey = Object.entries(customKeys).find(([k]) =>
        /_API_KEY$/.test(k),
      )?.[1];
      return { api_key: typeof apiKey === "string" ? apiKey : "" };
    }
  }
}

function buildProviderSlot(row: ProviderRow, index: number): ProviderSlot {
  const credentials = buildCredentials(row);
  const mp = row.modelProvider;
  const customKeys = decryptCustomKeys(mp.customKeys);
  const baseURL = pickString(customKeys, "base_url") ?? pickString(customKeys, "BASE_URL");
  // Region lives on credentials for Bedrock/Vertex; mirror to the
  // top-level `region` field so the Go gateway's non-provider-specific
  // code (logging, fallback, health probes) can read it without
  // re-parsing the opaque credentials blob.
  const region = pickString(credentials, "region");
  const deploymentMap = mp.deploymentMapping
    ? (mp.deploymentMapping as Record<string, string>)
    : undefined;
  return {
    id: row.id,
    slot: row.slot ?? (index === 0 ? "primary" : `fallback_${index}`),
    type: mp.provider,
    credentials,
    ...(baseURL ? { base_url: baseURL } : {}),
    ...(region ? { region } : {}),
    ...(deploymentMap ? { deployment_map: deploymentMap } : {}),
    config: buildProviderConfig(row),
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function buildProviderConfig(row: ProviderRow): Record<string, unknown> {
  const gatewayExtras = (row.providerConfig ?? {}) as Record<string, unknown>;
  return {
    rate_limit: {
      rpm: row.rateLimitRpm,
      tpm: row.rateLimitTpm,
      rpd: row.rateLimitRpd,
    },
    health: {
      status: row.healthStatus.toLowerCase(),
      circuit_opened_at: row.circuitOpenedAt?.toISOString() ?? null,
    },
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

function subtract(a: string, b: string): string {
  // Strings are Prisma.Decimal renderings — parse-safe for money math here
  // because we keep 6 decimals and values stay well under Number.MAX_SAFE.
  const x = Number.parseFloat(a);
  const y = Number.parseFloat(b);
  return (x - y).toFixed(6);
}
