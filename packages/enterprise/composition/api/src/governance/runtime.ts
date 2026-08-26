import {
  GovernanceBudgetOverviewPort,
  GovernanceClickHouseResolverPort,
  GovernanceEventingPort,
  GovernanceSetupActivityPort,
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
  PostgresGovernanceInstallationAdapter,
  type GovernanceInstallationOptions,
} from "@langwatch/enterprise-governance-server";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { Cluster, Redis } from "ioredis";
import { AppAdminWorkspaceViewAuditAdapter } from "./admin-workspace-view-audit.adapter";
import { AppCliTokenRevocationAdapter } from "./cli-token-revocation.adapter";
import { AppIngestionKeyAdapter } from "./ingestion-key.adapter";
import { AppGovernanceOttlGateway } from "./ottl-gateway.client";
import { AppPersonalUsageAdapter } from "./personal-usage.adapter";
import type { AppPersonalUsageReadAdapter } from "./personal-usage.clickhouse.repository";
import {
  AppAiToolProviderCatalogPort,
  AppAiToolSlugPort,
  AppCliAdminContactPort,
  AppPersonalVirtualKeyIssuerPort,
  type GovernanceModelProviderCatalogPort,
  type GovernanceOrganizationContactPort,
  type GovernanceVirtualKeyPort,
} from "./governance-products.adapter";
import type { AppGovernanceOcsfEventsAdapter } from "./governance-ocsf-events.clickhouse.repository";
import type { AppGovernanceTraceActivityAdapter } from "./governance-trace-activity.clickhouse.repository";
import { AppQuarantineFillEvaluatorAdapter } from "./quarantine-fill-evaluator.adapter";
type GovernanceRuntimeOptions = {
  setupActivity?: AppGovernanceTraceActivityAdapter;
  ocsfEvents?: AppGovernanceOcsfEventsAdapter;
  traceActivity?: AppGovernanceTraceActivityAdapter;
  personalUsage?: AppPersonalUsageReadAdapter;
  organizations: OrganizationService;
  projects: ProjectService;
  apiKeys: ApiKeyService;
  gatewayBaseUrl: string;
  virtualKeys: GovernanceVirtualKeyPort;
  budgetOverview: GovernanceBudgetOverviewPort;
  providers: GovernanceModelProviderCatalogPort;
  contacts: GovernanceOrganizationContactPort;
  eventing: GovernanceEventingPort;
  activityClickhouse: GovernanceClickHouseResolverPort;
  ingestionSourceEntitlements: IngestionSourceEntitlementsPort;
  ingestionSourceLifecycle: IngestionSourceLifecyclePort;
  ingestionEncryption: GovernanceInstallationOptions["ingestionEncryption"];
  ingestionSecretPepper: string;
  ingestionDiagnostics: GovernanceInstallationOptions["ingestionDiagnostics"];
  redis?: Redis | Cluster | null;
  ottl?: {
    baseUrl?: string | null;
    secret?: string | null;
    request?: typeof fetch;
    now?: () => number;
  };
};

class AppGovernanceSetupActivityPort extends GovernanceSetupActivityPort {
  private constructor(private readonly activity: AppGovernanceTraceActivityAdapter) {
    super();
  }

  static create(
    activity: AppGovernanceTraceActivityAdapter,
  ): AppGovernanceSetupActivityPort {
    return new AppGovernanceSetupActivityPort(activity);
  }

  hasRecentActivity(input: { tenantId: string; sinceMs: number }): Promise<boolean> {
    return this.activity.hasRecentActivity(input);
  }
}

/** Composes one process-owned Governance capability and exposes no sub-services. */
export class AppGovernanceRuntime {
  private constructor() {}

  static create(
    database: GovernanceInstallationOptions["database"],
    options: GovernanceRuntimeOptions,
  ): GovernanceService {
    const cliTokens = AppCliTokenRevocationAdapter.create(options.redis);
    const adminWorkspace = AppAdminWorkspaceViewAuditAdapter.create({
      prisma: database,
      projects: options.projects,
      ocsfRepository: options.ocsfEvents,
    });
    const quarantine = AppQuarantineFillEvaluatorAdapter.create({
      projects: options.projects,
      traceActivity: options.traceActivity,
    });
    const ingestionKeys = AppIngestionKeyAdapter.create(options.apiKeys);

    return PostgresGovernanceInstallationAdapter.create({
      database,
      organizations: options.organizations,
      projects: options.projects,
      gatewayBaseUrl: options.gatewayBaseUrl,
      eventing: options.eventing,
      activityClickhouse: options.activityClickhouse,
      ingestionSourceEntitlements: options.ingestionSourceEntitlements,
      ingestionSourceLifecycle: options.ingestionSourceLifecycle,
      ingestionEncryption: options.ingestionEncryption,
      ingestionSecretPepper: options.ingestionSecretPepper,
      ingestionDiagnostics: options.ingestionDiagnostics,
      personalUsageReader: AppPersonalUsageAdapter.create(
        options.personalUsage,
      ).buildReader(),
      personalVirtualKeyIssuer: AppPersonalVirtualKeyIssuerPort.create(
        options.virtualKeys,
      ),
      budgetOverview: options.budgetOverview,
      aiToolSlugs: new AppAiToolSlugPort(),
      aiToolProviders: AppAiToolProviderCatalogPort.create(options.providers),
      cliContacts: AppCliAdminContactPort.create(options.contacts),
      cliTokenStore: cliTokens.tokenStore(),
      diagnostics: cliTokens.diagnostics(),
      adminWorkspaceOcsf: adminWorkspace.ocsf(),
      adminWorkspaceDiagnostics: adminWorkspace.diagnostics(),
      quarantineTenant: quarantine.tenant(),
      quarantineTraceActivity: quarantine.traceActivity(),
      quarantineDiagnostics: quarantine.diagnostics(),
      setupActivity: options.setupActivity
        ? AppGovernanceSetupActivityPort.create(options.setupActivity)
        : undefined,
      ocsfEvents: options.ocsfEvents,
      ingestionKeyRepository: ingestionKeys.repository(),
      ingestionKeyIssuer: ingestionKeys.issuer(),
      ottl: AppGovernanceOttlGateway.create(options.ottl ?? {}),
    }).build();
  }
}
