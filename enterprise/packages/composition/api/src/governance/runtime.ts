import {
  GovernanceBudgetOverview,
  GovernanceClickHouseResolver,
  GovernanceEventing,
  GovernanceSetupActivity,
  IngestionSourceEntitlements,
  IngestionSourceLifecycle,
  PostgresGovernanceInstallationAdapter,
  type GovernanceInstallationOptions,
} from "@langwatch/enterprise-governance-server";
import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { Cluster, Redis } from "ioredis";
import { AppAdminWorkspaceViewAuditAdapter } from "./admin-workspace-view-audit.adapter.ts";
import { AppCliTokenRevocationAdapter } from "./cli-token-revocation.adapter.ts";
import { AppIngestionKeyAdapter } from "./ingestion-key.adapter.ts";
import { AppGovernanceOttlGateway } from "./ottl-gateway.client.ts";
import { AppPersonalUsageReader } from "./personal-usage.adapter.ts";
import type { AppPersonalUsageReadAdapter } from "./personal-usage.clickhouse.repository.ts";
import {
  AppAiToolProviderCatalog,
  AppAiToolSlug,
  AppCliAdminContact,
  AppPersonalVirtualKeyIssuer,
  type GovernanceModelProviderCatalog,
  type GovernanceOrganizationContact,
  type GovernanceVirtualKey,
} from "./governance-products.adapter.ts";
import type { AppGovernanceOcsfEventsAdapter } from "./governance-ocsf-events.clickhouse.repository.ts";
import type { AppGovernanceTraceActivityAdapter } from "./governance-trace-activity.clickhouse.repository.ts";
import { AppQuarantineFillEvaluatorAdapter } from "./quarantine-fill-evaluator.adapter.ts";
type GovernanceRuntimeOptions = {
  setupActivity?: AppGovernanceTraceActivityAdapter;
  ocsfEvents?: AppGovernanceOcsfEventsAdapter;
  traceActivity?: AppGovernanceTraceActivityAdapter;
  personalUsage?: AppPersonalUsageReadAdapter;
  organizations: OrganizationService;
  projects: ProjectApi;
  apiKeys: ApiKeyApi;
  gatewayBaseUrl: string;
  virtualKeys: GovernanceVirtualKey;
  budgetOverview: GovernanceBudgetOverview;
  providers: GovernanceModelProviderCatalog;
  contacts: GovernanceOrganizationContact;
  eventing: GovernanceEventing;
  activityClickhouse: GovernanceClickHouseResolver;
  ingestionSourceEntitlements: IngestionSourceEntitlements;
  ingestionSourceLifecycle: IngestionSourceLifecycle;
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

class AppGovernanceSetupActivity extends GovernanceSetupActivity {
  private constructor(private readonly activity: AppGovernanceTraceActivityAdapter) {
    super();
  }

  static create(activity: AppGovernanceTraceActivityAdapter): AppGovernanceSetupActivity {
    return new AppGovernanceSetupActivity(activity);
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
  ): GovernanceApi {
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
      personalUsageReader: options.personalUsage
        ? AppPersonalUsageReader.create(options.personalUsage)
        : undefined,
      personalVirtualKeyIssuer: AppPersonalVirtualKeyIssuer.create(options.virtualKeys),
      budgetOverview: options.budgetOverview,
      aiToolSlugs: new AppAiToolSlug(),
      aiToolProviders: AppAiToolProviderCatalog.create(options.providers),
      cliContacts: AppCliAdminContact.create(options.contacts),
      cliTokenStore: cliTokens.tokenStore(),
      diagnostics: cliTokens.diagnostics(),
      adminWorkspaceOcsf: adminWorkspace.ocsf(),
      adminWorkspaceDiagnostics: adminWorkspace.diagnostics(),
      quarantineTenant: quarantine.tenant(),
      quarantineTraceActivity: quarantine.traceActivity(),
      quarantineDiagnostics: quarantine.diagnostics(),
      setupActivity: options.setupActivity
        ? AppGovernanceSetupActivity.create(options.setupActivity)
        : undefined,
      ocsfEvents: options.ocsfEvents,
      ingestionKeyRepository: ingestionKeys.repository(),
      ingestionKeyIssuer: ingestionKeys.issuer(),
      ottl: AppGovernanceOttlGateway.create(options.ottl ?? {}),
    }).build();
  }
}
