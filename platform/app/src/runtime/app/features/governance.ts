import {
  CanonicalCostExtractorService,
  GovernanceSetupActivityPort,
  PostgresGovernanceAdapter,
  PostgresGovernanceOcsfExportAdapter,
  PostgresGovernanceSetupStateAdapter,
  PostgresIngestionTemplateAdapter,
  type CanonicalCostEvent,
  type OtlpLogsRequest,
} from "@langwatch/enterprise-governance-server";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ApiKeyService } from "@langwatch/api-key-contract";
import type {
  GovernanceAiToolCatalogService,
  GovernanceAdminWorkspaceViewAuditService,
  GovernanceCliBootstrapService,
  GovernanceCliSessionInventoryService,
  GovernanceCliTokenRevocationService,
  GovernanceIngestionKeyService,
  GovernanceOttlGateway,
  GovernanceOcsfExportService,
  GovernancePolicyService,
  GovernancePersonalVirtualKeyService,
  GovernancePersonalUsageService,
  GovernanceQuarantineFillService,
  GovernanceRoutingPolicyService,
  GovernanceSetupStateService,
  IngestionTemplatesService,
} from "@langwatch/enterprise-governance-contract";
import type { Cluster, Redis } from "ioredis";
import type { PrismaClient } from "~/generated/prisma/client";
import type { BudgetOverviewService } from "~/server/gateway/budgetOverview.service";
import type { GatewayBudgetClickHouseRepository } from "~/server/gateway/budget.clickhouse.repository";
import { AppGovernanceOttlGateway } from "./governance/ottl-gateway.client";
import { AppPersonalUsageAdapter } from "./governance/personal-usage.adapter";
import type { PersonalUsageClickHouseRepository } from "./governance/personal-usage.clickhouse.repository";
import { AppGovernanceProductAdapter } from "./governance/governance-products.adapter";
import { AppCliSessionInventoryAdapter } from "./governance/cli-session-inventory.adapter";
import { AppCliTokenRevocationAdapter } from "./governance/cli-token-revocation.adapter";
import { AppAdminWorkspaceViewAuditAdapter } from "./governance/admin-workspace-view-audit.adapter";
import { AppQuarantineFillEvaluatorAdapter } from "./governance/quarantine-fill-evaluator.adapter";
import type { GovernanceOcsfEventsClickHouseRepository } from "./governance/governance-ocsf-events.clickhouse.repository";
import type { GovernanceTraceActivityClickHouseRepository } from "./governance/governance-trace-activity.clickhouse.repository";
import { AppIngestionKeyAdapter } from "./governance/ingestion-key.adapter";

export type { CanonicalCostEvent };

type GovernanceSetupActivity = {
  hasRecentActivity(input: { tenantId: string; sinceMs: number }): Promise<boolean>;
};

class AppGovernanceSetupActivityPort extends GovernanceSetupActivityPort {
  private constructor(private readonly activity: GovernanceSetupActivity) {
    super();
  }

  static create(activity: GovernanceSetupActivity): AppGovernanceSetupActivityPort {
    return new AppGovernanceSetupActivityPort(activity);
  }

  hasRecentActivity(
    input: Parameters<GovernanceSetupActivityPort["hasRecentActivity"]>[0],
  ): Promise<boolean> {
    return this.activity.hasRecentActivity(input);
  }
}

export class AppGovernanceRuntime {
  private constructor(
    readonly canonicalCostExtractor: CanonicalCostExtractorService,
    readonly policy: GovernancePolicyService,
    readonly ingestionTemplates: IngestionTemplatesService,
    readonly setupState: GovernanceSetupStateService,
    readonly ocsfExport: GovernanceOcsfExportService,
    readonly ottlGateway: GovernanceOttlGateway,
    readonly projects: ProjectService,
    readonly personalUsage: GovernancePersonalUsageService,
    readonly routingPolicies: GovernanceRoutingPolicyService,
    readonly personalVirtualKeys: GovernancePersonalVirtualKeyService,
    readonly aiTools: GovernanceAiToolCatalogService,
    readonly cliBootstrap: GovernanceCliBootstrapService,
    readonly cliSessions: GovernanceCliSessionInventoryService,
    readonly cliTokenRevocation: GovernanceCliTokenRevocationService,
    readonly adminWorkspaceViewAudit: GovernanceAdminWorkspaceViewAuditService,
    readonly quarantineFill: GovernanceQuarantineFillService,
    readonly ingestionKeys: GovernanceIngestionKeyService,
    readonly budgetOverview: BudgetOverviewService,
  ) {}

  static create(
    database: PrismaClient,
    options: {
      setupActivity?: GovernanceSetupActivity;
      ocsfEvents?: GovernanceOcsfEventsClickHouseRepository;
      traceActivity?: GovernanceTraceActivityClickHouseRepository;
      personalUsage?: PersonalUsageClickHouseRepository;
      organizations: OrganizationService;
      projects: ProjectService;
      apiKeys?: ApiKeyService;
      budgetRepository?: GatewayBudgetClickHouseRepository;
      gatewayBaseUrl: string;
      redis?: Redis | Cluster | null;
      ottl?: {
        baseUrl?: string | null;
        secret?: string | null;
        request?: typeof fetch;
        now?: () => number;
      };
    },
  ): AppGovernanceRuntime {
    const personalUsage = AppPersonalUsageAdapter.create(options.personalUsage).build();
    const products = AppGovernanceProductAdapter.create({
      database,
      organizations: options.organizations,
      personalUsage,
      budgetRepository: options.budgetRepository,
      gatewayBaseUrl: options.gatewayBaseUrl,
    }).build();

    return new AppGovernanceRuntime(
      CanonicalCostExtractorService.create(),
      PostgresGovernanceAdapter.create({ database }).build().policy,
      PostgresIngestionTemplateAdapter.create({ database }).build(),
      PostgresGovernanceSetupStateAdapter.create({
        database,
        activity: options.setupActivity
          ? AppGovernanceSetupActivityPort.create(options.setupActivity)
          : undefined,
      }).build(),
      PostgresGovernanceOcsfExportAdapter.create({
        database,
        events: options.ocsfEvents,
      }).build(),
      AppGovernanceOttlGateway.create(options.ottl ?? {}),
      options.projects,
      personalUsage,
      products.routingPolicies,
      products.personalVirtualKeys,
      products.aiTools,
      products.cliBootstrap,
      AppCliSessionInventoryAdapter.create(options.redis).build(),
      AppCliTokenRevocationAdapter.create(options.redis).build(),
      AppAdminWorkspaceViewAuditAdapter.create({
        prisma: database,
        projects: options.projects,
        ocsfRepository: options.ocsfEvents,
      }).build(),
      AppQuarantineFillEvaluatorAdapter.create({
        projects: options.projects,
        traceActivity: options.traceActivity,
      }).build(),
      AppIngestionKeyAdapter.create({
        database,
        organizations: options.organizations,
        apiKeys: options.apiKeys!,
      }).build(),
      products.budgetOverview,
    );
  }

  extractCanonicalCostEvents(request: OtlpLogsRequest): CanonicalCostEvent[] {
    return this.canonicalCostExtractor.extract(request);
  }

  resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean> {
    return this.policy.resolveSourceNonBillable(input);
  }
}
