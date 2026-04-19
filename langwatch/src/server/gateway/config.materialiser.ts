/**
 * Materialise the payload returned from `GET /api/internal/gateway/config/:vk_id`.
 *
 * Shape: contract §4.2. Caller loads the VirtualKey + its provider chain and
 * hands off to this module; we collect applicable budgets, normalise enums,
 * and assemble the JSON blob the Go gateway expects.
 */
import type {
  GatewayBudget,
  GatewayProviderCredential,
  ModelProvider,
  PrismaClient,
  Project,
  Team,
  VirtualKey,
} from "@prisma/client";

import { parseVirtualKeyConfig } from "./virtualKey.config";
import type { VirtualKeyWithChain } from "./virtualKey.repository";

export type ProviderSlot = {
  slot: string;
  type: string;
  credentials_ref: string;
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
    resets_at: string;
    on_breach: "block" | "warn";
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
    const config = parseVirtualKeyConfig(vk.config);

    return {
      revision: vk.revision.toString(),
      vk_id: vk.id,
      status: vk.status === "ACTIVE" ? "active" : "revoked",
      display_prefix: vk.displayPrefix,
      environment: vk.environment === "LIVE" ? "live" : "test",
      organization_id: project.team.organizationId,
      project_id: project.id,
      team_id: project.teamId,
      principal_id: vk.principalUserId,
      providers: chain.map((row, index) => ({
        slot: row.slot ?? (index === 0 ? "primary" : `fallback_${index}`),
        type: row.modelProvider.provider,
        credentials_ref: row.id,
        config: buildProviderConfig(row),
      })),
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
        resets_at: b.resetsAt.toISOString(),
        on_breach: b.onBreach === "BLOCK" ? "block" : "warn",
      })),
      metadata: config.metadata ?? {},
    };
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
    const rows = await this.prisma.gatewayProviderCredential.findMany({
      where: {
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

function buildProviderConfig(row: ProviderRow): Record<string, unknown> {
  const mp = row.modelProvider;
  const gatewayExtras = (row.providerConfig ?? {}) as Record<string, unknown>;
  return {
    base_url:
      typeof mp.customKeys === "object" && mp.customKeys && "base_url" in mp.customKeys
        ? (mp.customKeys as Record<string, unknown>)["base_url"]
        : undefined,
    deployment_mapping: mp.deploymentMapping ?? undefined,
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

function subtract(a: string, b: string): string {
  // Strings are Prisma.Decimal renderings — parse-safe for money math here
  // because we keep 6 decimals and values stay well under Number.MAX_SAFE.
  const x = Number.parseFloat(a);
  const y = Number.parseFloat(b);
  return (x - y).toFixed(6);
}
