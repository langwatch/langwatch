/**
 * CliBootstrapService — shared logic for the Storyboard Screen 4
 * login-completion ceremony. Returns inherited providers + monthly
 * budget. Consumed by both:
 *
 *   - tRPC `api.user.cliBootstrap` (session-cookie auth, /me dashboard)
 *   - REST `/api/auth/cli/bootstrap` (Bearer access_token, CLI device-flow)
 *
 * Both surfaces need the same shape so the CLI's
 * `formatLoginCeremony({ providers, budget })` (typescript-sdk
 * b8b21bb79) renders identically regardless of which path the data
 * came through.
 *
 * Empty-state safe — returns providers=[] + budget={null, 0, MONTHLY}
 * when the user has no personal workspace yet (fresh login flow,
 * no admin VK provisioning yet).
 *
 * Spec contracts:
 *   - Storyboard Screen 4 (gateway.md)
 *   - Phase 1B.5 atomic-task block (PR-3524-DESCRIPTION.md)
 */
import type { PrismaClient } from "@prisma/client";

import {
  getClickHouseClientForProject,
  isClickHouseEnabled,
} from "~/server/clickhouse/clickhouseClient";
import { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { GatewayBudgetService } from "~/server/gateway/budget.service";
import { ModelProviderService } from "~/server/modelProviders/modelProvider.service";
import {
  getProviderModelOptions,
  modelProviders as modelProviderRegistry,
} from "~/server/modelProviders/registry";
import { PersonalVirtualKeyService } from "./personalVirtualKey.service";
import { PersonalWorkspaceService } from "./personalWorkspace.service";

export interface CliBootstrapResult {
  providers: Array<{
    name: string;
    displayName: string;
    models: string[];
  }>;
  budget: {
    monthlyLimitUsd: number | null;
    monthlyUsedUsd: number;
    period: string;
  };
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
    const workspaceService = new PersonalWorkspaceService(this.prisma);
    const workspace = await workspaceService.findExisting({
      userId: input.userId,
      organizationId: input.organizationId,
    });
    if (!workspace) {
      return emptyBootstrap();
    }

    const providers = await this.resolveProviders(workspace.project.id);
    const budget = await this.resolveBudget({
      userId: input.userId,
      organizationId: input.organizationId,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
    });

    return { providers, budget };
  }

  private async resolveProviders(
    personalProjectId: string,
  ): Promise<CliBootstrapResult["providers"]> {
    const providerService = ModelProviderService.create(this.prisma);
    const accessibleProviders =
      await providerService.getProjectModelProviders(personalProjectId);
    return Object.entries(accessibleProviders)
      .filter(([providerKey, mp]) => {
        const def =
          modelProviderRegistry[
            providerKey as keyof typeof modelProviderRegistry
          ];
        if (!def || def.type !== "llm") return false;
        return mp.enabled;
      })
      .map(([providerKey]) => {
        const def =
          modelProviderRegistry[
            providerKey as keyof typeof modelProviderRegistry
          ];
        const models = getProviderModelOptions(providerKey, "chat").map(
          (m) => m.value,
        );
        return {
          name: providerKey,
          displayName: def?.name ?? providerKey,
          models,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
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

function emptyBootstrap(): CliBootstrapResult {
  return {
    providers: [],
    budget: {
      monthlyLimitUsd: null,
      monthlyUsedUsd: 0,
      period: "MONTHLY",
    },
  };
}
