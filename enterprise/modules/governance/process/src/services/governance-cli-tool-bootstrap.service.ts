import {
  cliBootstrapInputSchema,
  type AiToolCliCatalog,
  type CliBootstrapInput,
  type CliBootstrapResult,
  type PlatformToolPolicyMap,
} from "@langwatch/enterprise-governance-contract";

import type {
  CliAdminContactReader,
  CliBudgetOverview,
  CliBudgetOverviewReader,
} from "../app/governance.members.ts";

type AiToolCliCatalogReader = {
  resolveCliCatalogForUser(input: CliBootstrapInput): Promise<AiToolCliCatalog>;
  resolveToolPolicyMap(input: CliBootstrapInput): Promise<PlatformToolPolicyMap>;
};

export class DefaultGovernanceCliBootstrapService {
  private readonly catalog: AiToolCliCatalogReader;
  private readonly budgets: CliBudgetOverviewReader;
  private readonly contacts: CliAdminContactReader;
  private readonly gatewayUrl: string;

  private constructor({
    catalog,
    budgets,
    contacts,
    gatewayUrl,
  }: {
    catalog: AiToolCliCatalogReader;
    budgets: CliBudgetOverviewReader;
    contacts: CliAdminContactReader;
    gatewayUrl: string;
  }) {
    this.catalog = catalog;
    this.budgets = budgets;
    this.contacts = contacts;
    this.gatewayUrl = gatewayUrl;
  }

  static create(options: {
    catalog: AiToolCliCatalogReader;
    budgets: CliBudgetOverviewReader;
    contacts: CliAdminContactReader;
    gatewayUrl: string;
  }): DefaultGovernanceCliBootstrapService {
    return new DefaultGovernanceCliBootstrapService({
      catalog: options.catalog,
      budgets: options.budgets,
      contacts: options.contacts,
      gatewayUrl: options.gatewayUrl,
    });
  }

  async resolve(input: CliBootstrapInput): Promise<CliBootstrapResult> {
    const parsed = cliBootstrapInputSchema.parse(input);
    const [catalog, toolPolicies, overview, adminEmail] = await Promise.all([
      this.catalog.resolveCliCatalogForUser(parsed),
      this.catalog.resolveToolPolicyMap(parsed),
      this.budgets.overviewForUser(parsed),
      this.contacts.findAdminEmail(parsed.organizationId),
    ]);

    return {
      tools: catalog.tools,
      providers: catalog.providers.map((provider) => ({
        name: provider.providerKey,
        displayName: provider.displayName,
        configured: provider.configured,
      })),
      gatewayProviders: catalog.configuredProviderKeys,
      budget: collapseOverview(overview),
      gatewayUrl: this.gatewayUrl,
      adminEmail,
      toolPolicies,
    };
  }
}

function collapseOverview(overview: CliBudgetOverview): CliBootstrapResult["budget"] {
  const monthly = overview.gatewayAccess
    ? overview.budgets.find(({ window }) => window === "MONTH")
    : undefined;
  if (!monthly) {
    return { monthlyLimitUsd: null, monthlyUsedUsd: 0, period: "MONTHLY" };
  }

  return {
    monthlyLimitUsd: Number.parseFloat(monthly.limitUsd) || 0,
    monthlyUsedUsd: Number.parseFloat(monthly.spentUsd) || 0,
    period: "MONTHLY",
  };
}
