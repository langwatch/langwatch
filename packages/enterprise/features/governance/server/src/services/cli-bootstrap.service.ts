import {
  GovernanceCliBootstrapService,
  cliBootstrapInputSchema,
  type CliBootstrapInput,
  type CliBootstrapResult,
  type GovernanceAiToolCatalogService,
} from "@langwatch/enterprise-governance-contract";
import type {
  CliAdminContactPort,
  CliBudgetOverview,
  CliBudgetOverviewPort,
} from "../ports/cli-bootstrap.port";

export class DefaultGovernanceCliBootstrapService extends GovernanceCliBootstrapService {
  private constructor(
    private readonly catalog: GovernanceAiToolCatalogService,
    private readonly budgets: CliBudgetOverviewPort,
    private readonly contacts: CliAdminContactPort,
    private readonly gatewayUrl: string,
  ) {
    super();
  }

  static create(options: {
    catalog: GovernanceAiToolCatalogService;
    budgets: CliBudgetOverviewPort;
    contacts: CliAdminContactPort;
    gatewayUrl: string;
  }): DefaultGovernanceCliBootstrapService {
    return new DefaultGovernanceCliBootstrapService(
      options.catalog,
      options.budgets,
      options.contacts,
      options.gatewayUrl,
    );
  }

  async resolve(input: CliBootstrapInput): Promise<CliBootstrapResult> {
    const parsed = cliBootstrapInputSchema.parse(input);
    const [catalog, toolPolicies, overview, adminEmail] = await Promise.all([
      this.catalog.resolveCliCatalogForUser(parsed),
      this.catalog.resolveToolPolicyMap(parsed),
      this.budgets.overviewForUser(parsed),
      this.contacts.tryResolveAdminEmail(parsed.organizationId),
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
