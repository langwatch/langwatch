// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * CliBootstrapService - shared logic for the login-completion ceremony.
 * Returns the member's available AI tools (coding assistants they can run),
 * the model providers they can mint a personal virtual key for, and their
 * monthly budget. Consumed by both:
 *
 *   - tRPC `api.user.cliBootstrap` (session-cookie auth, /me dashboard)
 *   - REST `/api/auth/cli/bootstrap` (Bearer access_token, CLI device-flow)
 *
 * Both surfaces share this shape so the CLI's `formatLoginCeremony` renders
 * identically regardless of which path the data came through.
 *
 * Tools + providers are sourced from the org's AI Tools catalog (the same
 * tiles the /me portal renders), so the CLI only ever surfaces tools the org
 * actually published, not env-fed project providers the org never assigned.
 *
 * Empty-state safe - tools/providers fall back to empty when the org has no
 * catalog, and budget collapses to {null, 0, MONTHLY} when the user has no
 * personal workspace yet (fresh login flow, no VK provisioning yet).
 */
import type { PrismaClient } from "@prisma/client";

import { env } from "~/env.mjs";
import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { AiToolEntryService } from "./aiToolEntry.service";
import { resolveGatewayBaseUrl } from "./gatewayUrl";
import { PersonalVirtualKeyService } from "./personalVirtualKey.service";
import { PersonalWorkspaceService } from "./personalWorkspace.service";
import {
  PLATFORM_TOOL_POLICY_DEFAULTS,
  PLATFORM_TOOL_SLUGS,
  type PlatformToolPolicyMap,
} from "./platformToolPolicy.service";

export interface CliBootstrapResult {
  /**
   * Coding assistants the member can run via `langwatch <slug>`. Sourced
   * from the org's published coding_assistant catalog tiles (the same tiles
   * the /me portal renders), so the CLI "your AI tools" list and "try it"
   * commands only ever surface tools the org actually offers. Empty when the
   * org has not published any coding-assistant tile; the CLI then falls back
   * to its built-in default wrapper list.
   */
  tools: Array<{
    slug: string;
    displayName: string;
  }>;
  /**
   * Model providers the member can mint a personal virtual key for. Sourced
   * from the org's published model_provider catalog tiles (NOT the env-fed
   * project providers), each flagged with whether a live credential exists.
   * This is distinct from `tools`: providers back virtual keys, tools are the
   * coding assistants you run.
   */
  providers: Array<{
    name: string;
    displayName: string;
    configured: boolean;
  }>;
  /**
   * Provider families (e.g. "openai", "anthropic") for which the org has a
   * live, enabled credential the caller can reach - independent of whether a
   * `model_provider` catalog tile was ever published. This is what the gateway
   * can actually ROUTE through, so the CLI gateway preflight gates on this,
   * NOT on `providers` (which is the admin-curated mint-your-own-VK catalog).
   * Membership-scoped via `listConfiguredProvidersForUser`.
   */
  gatewayProviders: string[];
  budget: {
    monthlyLimitUsd: number | null;
    monthlyUsedUsd: number;
    period: string;
  };
  /**
   * Authoritative gateway base URL for the CLI to use as `cfg.gateway_url`.
   * Resolution lives in {@link resolveGatewayBaseUrl} - shared with the
   * personal-VK reveal card so /me and CLI surfaces report the same URL.
   * Note: in dev `scripts/start.sh` hijacks `LW_GATEWAY_BASE_URL` for the
   * Go control-plane URL, so on dev the SaaS branch is what keeps a
   * `langwatch claude` request off the Hono API (PORT+1000).
   */
  gatewayUrl: string;
  /**
   * Mailto target the CLI can render when preflight fails (gateway
   * down, no provider configured, no personal VK). First org admin by
   * createdAt, same selection used by the budget-exceeded payload so
   * the user sees a consistent "ask this person" address across
   * surfaces. Null when the org has no admin row yet.
   */
  adminEmail: string | null;
  /**
   * Per-tool path policy resolved for this org (stored overrides merged over
   * the hardcoded defaults). The CLI caches this at login and gates
   * `langwatch <tool>` path selection on it; an offline / legacy CLI with no
   * cached map falls back to the same hardcoded defaults.
   */
  toolPolicies: PlatformToolPolicyMap;
}

function resolveGatewayUrl(): string {
  return resolveGatewayBaseUrl({
    publicUrl: env.LW_GATEWAY_PUBLIC_URL,
    baseUrl: env.LW_GATEWAY_BASE_URL,
    isSaas: env.IS_SAAS,
  });
}

const SCOPE_RANK: Record<string, number> = {
  PRINCIPAL: 0,
  VIRTUAL_KEY: 1,
  PROJECT: 2,
  TEAM: 3,
  ORGANIZATION: 4,
};

export class CliBootstrapService {
  constructor(private readonly prisma: PrismaClient) {}

  static create(prisma: PrismaClient): CliBootstrapService {
    return new CliBootstrapService(prisma);
  }

  async resolve(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliBootstrapResult> {
    // Per-tool policy is org-level, independent of whether the user has a
    // personal workspace yet; a fresh login still needs the cached map.
    // Scoped to the user so a department-bound tile only governs the paths
    // of members who can actually see it.
    const toolPolicies = await this.resolveToolPolicies({
      organizationId: input.organizationId,
      userId: input.userId,
    });

    // Tools + providers come from the org's catalog (org + member scoped),
    // not the personal workspace — a member sees the tools they can run and
    // the providers they can mint a key for even before any VK provisioning.
    const catalog = await AiToolEntryService.create(
      this.prisma,
    ).resolveCliCatalogForUser({
      organizationId: input.organizationId,
      userId: input.userId,
    });
    const providers = catalog.providers.map((p) => ({
      name: p.providerKey,
      displayName: p.displayName,
      configured: p.configured,
    }));
    const adminEmail = await this.resolveAdminEmail(input.organizationId);

    const workspaceService = new PersonalWorkspaceService(this.prisma);
    const workspace = await workspaceService.findExisting({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const budget = workspace
      ? await this.resolveBudget({
          userId: input.userId,
          organizationId: input.organizationId,
          teamId: workspace.team.id,
          projectId: workspace.project.id,
        })
      : { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" };

    return {
      tools: catalog.tools,
      providers,
      gatewayProviders: catalog.configuredProviderKeys,
      budget,
      gatewayUrl: resolveGatewayUrl(),
      adminEmail,
      toolPolicies,
    };
  }

  /**
   * The login `toolPolicies` map. Derived from the coding_assistant tiles
   * the user can see (per-tool slug) merged over the hardcoded
   * {@link PLATFORM_TOOL_POLICY_DEFAULTS}: claude/codex/gemini/opencode =
   * both paths, cursor = gateway only. A tool with no visible tile keeps
   * its default, so the map is always complete for every known slug - the
   * exact wire shape the CLI caches and gates on. Replaces the retired
   * PlatformToolPolicy table.
   */
  private async resolveToolPolicies({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<PlatformToolPolicyMap> {
    const overrides = await AiToolEntryService.create(
      this.prisma,
    ).resolveToolPolicyOverrides({ organizationId, userId });

    const map = {} as PlatformToolPolicyMap;
    for (const slug of PLATFORM_TOOL_SLUGS) {
      map[slug] = overrides[slug] ?? { ...PLATFORM_TOOL_POLICY_DEFAULTS[slug] };
    }
    return map;
  }

  private async resolveAdminEmail(
    organizationId: string,
  ): Promise<string | null> {
    const admin = await this.prisma.organizationUser.findFirst({
      where: { organizationId, role: "ADMIN" },
      include: { user: { select: { email: true } } },
      orderBy: { createdAt: "asc" },
    });
    return admin?.user.email ?? null;
  }

  private async resolveBudget(input: {
    userId: string;
    organizationId: string;
    teamId: string;
    projectId: string;
  }): Promise<CliBootstrapResult["budget"]> {
    const vkService = PersonalVirtualKeyService.create(this.prisma);
    const vks = await vkService.list({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    const personalVk = vks[0];

    if (!personalVk || !isClickHouseEnabled()) {
      return { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" };
    }

    const chRepo = new GatewayBudgetClickHouseRepository(async (projectId) => {
      const client = await getClickHouseClientForProject(projectId);
      if (!client) {
        throw new Error(
          `ClickHouse enabled but no client for project ${projectId}`,
        );
      }
      return client;
    });
    const budgetService = GatewayBudgetService.create(this.prisma, chRepo);
    const decision = await budgetService.check({
      organizationId: input.organizationId,
      teamId: input.teamId,
      projectId: input.projectId,
      virtualKeyId: personalVk.id,
      principalUserId: input.userId,
      projectedCostUsd: 0,
    });

    const ranked = decision.scopes
      .map((s) => ({
        scope: s.scope,
        spent: Number.parseFloat(s.spentUsd) || 0,
        limit: Number.parseFloat(s.limitUsd) || 0,
        window: s.window,
        rank: SCOPE_RANK[s.scope] ?? 99,
      }))
      .filter((s) => s.limit > 0)
      .sort((a, b) => a.rank - b.rank);
    const chosen = ranked[0];
    if (!chosen) {
      return { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" };
    }
    return {
      monthlyLimitUsd: chosen.limit,
      monthlyUsedUsd: chosen.spent,
      period: chosen.window,
    };
  }
}

