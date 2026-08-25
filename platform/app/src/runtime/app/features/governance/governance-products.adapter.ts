// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernancePersonalUsageService,
  PersonalVirtualKey,
} from "@langwatch/enterprise-governance-contract";
import {
  AiToolProviderCatalogPort,
  AiToolSlugPort,
  CliAdminContactPort,
  CliBudgetOverviewPort,
  DefaultGovernanceCliBootstrapService,
  PersonalVirtualKeyIssuerPort,
  PostgresAiToolCatalogAdapter,
  PostgresPersonalVirtualKeyAdapter,
  PostgresRoutingPolicyAdapter,
} from "@langwatch/enterprise-governance-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import { nanoid } from "nanoid";
import type { PrismaClient } from "~/generated/prisma/client";
import { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import type { VirtualKeyWithScopes } from "~/server/gateway/virtualKey.repository";
import { VirtualKeyService } from "~/server/gateway/virtualKey.service";
import { modelProviders } from "~/server/modelProviders/registry";
import { resolveOrgAdminEmail } from "~/server/organizations/resolveOrgAdminEmail";

class AppPersonalVirtualKeyIssuerPort extends PersonalVirtualKeyIssuerPort {
  private constructor(private readonly virtualKeys: VirtualKeyService) {
    super();
  }

  static create(
    virtualKeys: VirtualKeyService,
  ): AppPersonalVirtualKeyIssuerPort {
    return new AppPersonalVirtualKeyIssuerPort(virtualKeys);
  }

  async issue(input: {
    organizationId: string;
    userId: string;
    personalProjectId: string;
    label: string;
    routingPolicyId: string | null;
  }): Promise<{ virtualKey: PersonalVirtualKey; secret: string }> {
    const issued = await this.virtualKeys.create({
      organizationId: input.organizationId,
      name: input.label,
      description: "Personal virtual key",
      principalUserId: input.userId,
      actorUserId: input.userId,
      scopes: [{ scopeType: "PROJECT", scopeId: input.personalProjectId }],
      routingPolicyId: input.routingPolicyId,
    });
    return {
      virtualKey: toPersonalVirtualKey(issued.virtualKey),
      secret: issued.secret,
    };
  }

  async revoke(input: {
    id: string;
    organizationId: string;
    actorUserId: string;
  }): Promise<PersonalVirtualKey> {
    return toPersonalVirtualKey(await this.virtualKeys.revoke(input));
  }
}

class AppAiToolSlugPort extends AiToolSlugPort {
  generate(displayName: string): string {
    const base = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
    const stem = base.length > 0 ? base : "tool";
    return `${stem}-${nanoid(6).toLowerCase().replace(/[^a-z0-9]/g, "x")}`;
  }
}

class AppAiToolProviderCatalogPort extends AiToolProviderCatalogPort {
  list(): Array<{
    providerKey: string;
    displayName: string;
    type: string;
  }> {
    return Object.entries(modelProviders).map(([providerKey, provider]) => ({
      providerKey,
      displayName: provider.name,
      type: provider.type,
    }));
  }
}

class AppCliBudgetOverviewPort extends CliBudgetOverviewPort {
  private constructor(private readonly budgets: BudgetOverviewService) {
    super();
  }

  static create(budgets: BudgetOverviewService): AppCliBudgetOverviewPort {
    return new AppCliBudgetOverviewPort(budgets);
  }

  async overviewForUser(input: {
    userId: string;
    organizationId: string;
  }) {
    const overview = await this.budgets.overviewForUser(input);
    return {
      gatewayAccess: overview.gatewayAccess,
      budgets: overview.budgets.map(({ window, limitUsd, spentUsd }) => ({
        window,
        limitUsd,
        spentUsd,
      })),
    };
  }
}

class AppCliAdminContactPort extends CliAdminContactPort {
  private constructor(private readonly database: PrismaClient) {
    super();
  }

  static create(database: PrismaClient): AppCliAdminContactPort {
    return new AppCliAdminContactPort(database);
  }

  tryResolveAdminEmail(organizationId: string): Promise<string | null> {
    return resolveOrgAdminEmail({ prisma: this.database, organizationId });
  }
}

export class AppGovernanceProductAdapter {
  private constructor(
    private readonly options: {
      database: PrismaClient;
      organizations: OrganizationService;
      personalUsage: GovernancePersonalUsageService;
      budgetRepository?: GatewayBudgetClickHouseRepository;
      gatewayBaseUrl: string;
    },
  ) {}

  static create(options: {
    database: PrismaClient;
    organizations: OrganizationService;
    personalUsage: GovernancePersonalUsageService;
    budgetRepository?: GatewayBudgetClickHouseRepository;
    gatewayBaseUrl: string;
  }): AppGovernanceProductAdapter {
    return new AppGovernanceProductAdapter(options);
  }

  build() {
    const routingPolicies = PostgresRoutingPolicyAdapter.create({
      database: this.options.database,
    }).build();
    const personalVirtualKeys = PostgresPersonalVirtualKeyAdapter.create({
      database: this.options.database,
      issuer: AppPersonalVirtualKeyIssuerPort.create(
        VirtualKeyService.create(this.options.database),
      ),
      organizations: this.options.organizations,
      policies: routingPolicies,
      gatewayBaseUrl: this.options.gatewayBaseUrl,
    }).build();
    const aiTools = PostgresAiToolCatalogAdapter.create({
      database: this.options.database,
      slugs: new AppAiToolSlugPort(),
      providers: new AppAiToolProviderCatalogPort(),
    }).build();
    const budgetOverview = BudgetOverviewService.create({
      database: this.options.database,
      budgetRepository: this.options.budgetRepository,
      personalUsage: this.options.personalUsage,
      organizations: this.options.organizations,
      personalVirtualKeys,
    });
    const cliBootstrap = DefaultGovernanceCliBootstrapService.create({
      catalog: aiTools,
      budgets: AppCliBudgetOverviewPort.create(budgetOverview),
      contacts: AppCliAdminContactPort.create(this.options.database),
      gatewayUrl: this.options.gatewayBaseUrl,
    });

    return {
      routingPolicies,
      personalVirtualKeys,
      aiTools,
      cliBootstrap,
      budgetOverview,
    };
  }
}

function toPersonalVirtualKey(key: VirtualKeyWithScopes): PersonalVirtualKey {
  return {
    id: key.id,
    organizationId: key.organizationId,
    name: key.name,
    description: key.description,
    displayPrefix: key.displayPrefix,
    status: key.status,
    principalUserId: key.principalUserId,
    routingPolicyId: key.routingPolicyId,
    createdAtMs: key.createdAt.getTime(),
    updatedAtMs: key.updatedAt.getTime(),
    lastUsedAtMs: key.lastUsedAt?.getTime() ?? null,
    scopes: key.scopes.map(({ scopeType, scopeId }) => ({ scopeType, scopeId })),
  };
}
