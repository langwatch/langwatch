// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type {
  GovernanceOttlGateway,
  GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  AiToolProviderCatalog,
  AiToolSlug,
} from "../repositories/ai-tool-catalog.repository.ts";
import { PrismaDepartmentRepository } from "../repositories/prisma/prisma.department.repository.ts";
import { PrismaRoutingPolicyRepository } from "../repositories/prisma/prisma.governance-routing.repository.ts";
import { PrismaActivityMonitorRepository } from "../repositories/prisma/prisma.ingestion-source-activity.repository.ts";
import { CanonicalCostExtractorService } from "../services/canonical-cost-extractor.service.ts";
import { DefaultGovernanceCliSessionInventoryService } from "../services/cli-session-inventory.service.ts";
import { DefaultGovernanceCliTokenRevocationService } from "../services/cli-token-revocation.service.ts";
import type { DepartmentOrganizations } from "../services/department.service.ts";
import { DepartmentService } from "../services/department.service.ts";
import { GovernanceActivityOperationsService } from "../services/governance-activity-operations.service.ts";
import { DefaultGovernanceCliBootstrapService } from "../services/governance-cli-tool-bootstrap.service.ts";
import { DefaultGovernanceService } from "../services/governance-facade.service.ts";
import { GovernanceIngestionOperationsService } from "../services/governance-ingestion-operations.service.ts";
import { GovernanceLifecycleOperationsService } from "../services/governance-lifecycle-operations.service.ts";
import { DefaultGovernancePersonalVirtualKeyService } from "../services/governance-personal-key.service.ts";
import { DefaultGovernanceRoutingPolicyService } from "../services/governance-routing.service.ts";
import { GovernanceRulesOperationsService } from "../services/governance-rules-operations.service.ts";
import { IngestionCredentialsService } from "../services/ingestion-credentials.service.ts";
import { ActivityMonitorService } from "../services/ingestion-source-activity.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../services/ingestion-source-secret.service.ts";
import { PersonalIngestionKeyService } from "../services/personal-ingestion-key.service.ts";
import { DefaultGovernancePersonalUsageService } from "../services/personal-usage.service.ts";
import { PullDestinationService } from "../services/pull-destination.service.ts";
import { QuarantineFillEvaluatorService } from "../services/quarantine-fill.service.ts";
import { PostgresGovernanceAdapter } from "./governance-policy-composition.build.ts";
import type {
  CliAdminContactReader,
  PersonalBudgetOverviewReader,
  GovernanceDiagnosticsSink,
  GovernanceEncryptor,
  GovernanceEventingChannel,
  GovernanceOcsfEventsReader,
  GovernanceSetupActivityReader,
  GovernanceClickHouseResolver,
  IngestionSourceEntitlements,
  IngestionSourceLifecycleChannel,
  PersonalUsageReader,
  PersonalVirtualKeyIssuer,
  QuarantineTenantResolver,
  QuarantineTraceActivityReader,
} from "./governance.members.ts";

/**
 * The sole server-side installation boundary for Governance. The app supplies
 * members and neighbouring feature services; this composition owns all
 * Governance repositories and collaborating service construction.
 */
export type GovernanceInstallationOptions = {
  database: ProcessMembers["prisma"];
  organizations: OrganizationService;
  memberDepartments: DepartmentOrganizations;
  projects: ProjectApi;
  gatewayBaseUrl: string;
  eventing: GovernanceEventingChannel;
  activityClickhouse: GovernanceClickHouseResolver;
  ingestionSourceEntitlements: IngestionSourceEntitlements;
  ingestionSourceLifecycle: IngestionSourceLifecycleChannel;
  ingestionEncryption: GovernanceEncryptor;
  ingestionSecretPepper: string;
  ingestionDiagnostics: GovernanceDiagnosticsSink;
  personalUsageReader?: PersonalUsageReader;
  personalVirtualKeyIssuer: PersonalVirtualKeyIssuer;
  budgetOverview: PersonalBudgetOverviewReader;
  aiToolSlugs: AiToolSlug;
  aiToolProviders: AiToolProviderCatalog;
  cliContacts: CliAdminContactReader;
  auth: Pick<AuthApi, "findCliTokenRecordsForUser" | "revokeCliTokens">;
  apiKeys: Pick<
    ApiKeyApi,
    | "revokeCliSessionKey"
    | "create"
    | "revoke"
    | "findById"
    | "findByLookupId"
    | "findIngestionKeysForUser"
  >;
  gateway: Pick<GatewayApi, "findPersonalVirtualKeys" | "findVirtualKeyById">;
  modelProviders: Pick<ModelProviderApi, "countEnabledInScopes">;
  diagnostics?: GovernanceDiagnosticsSink;
  adminWorkspaceDiagnostics?: GovernanceDiagnosticsSink;
  quarantineTenant: QuarantineTenantResolver;
  quarantineTraceActivity?: QuarantineTraceActivityReader;
  quarantineDiagnostics?: GovernanceDiagnosticsSink;
  setupActivity?: GovernanceSetupActivityReader;
  ocsfEvents?: GovernanceOcsfEventsReader;
  ottl: GovernanceOttlGateway;
};

import { HttpProviderAccountChannel } from "../channels/http/http.provider-account.channel.ts";
import { PrismaAdminWorkspaceViewAuditRepository } from "../repositories/prisma/prisma.admin-workspace-view-audit.repository.ts";
import { PrismaAiToolCatalogRepository } from "../repositories/prisma/prisma.ai-tool-catalog.repository.ts";
import { PrismaAnomalyRuleRepository } from "../repositories/prisma/prisma.anomaly-rule.repository.ts";
import { PrismaGovernanceSetupStateRepository } from "../repositories/prisma/prisma.governance-setup-state.repository.ts";
import { PrismaIngestionSourceRepository } from "../repositories/prisma/prisma.ingestion-source.repository.ts";
import { PrismaIngestionTemplateRepository } from "../repositories/prisma/prisma.ingestion-template.repository.ts";
import { PrismaGovernanceOcsfExportRepository } from "../repositories/prisma/prisma.ocsf-export.repository.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../services/admin-workspace-view-audit.service.ts";
import { DefaultGovernanceAiToolCatalogService } from "../services/ai-tool-catalog.service.ts";
import { AnomalyRuleService } from "../services/anomaly-rule.service.ts";
import { DefaultGovernanceSetupStateService } from "../services/governance-setup-state.service.ts";
import { IngestionSourceService } from "../services/ingestion-source.service.ts";
import { IngestionTemplateService } from "../services/ingestion-template.service.ts";
import { DefaultGovernanceOcsfExportService } from "../services/ocsf-export.service.ts";

/** Builds the one process-owned GovernanceApi from injected members. */
export class GovernanceInstallationComposition {
  private constructor(private readonly options: GovernanceInstallationOptions) {}

  static create(options: GovernanceInstallationOptions): GovernanceInstallationComposition {
    return new GovernanceInstallationComposition(options);
  }

  build(): GovernanceApi {
    const anomalyRules = AnomalyRuleService.create({
      repository: PrismaAnomalyRuleRepository.create(this.options.database),
    });
    const departments = DepartmentService.create({
      repository: PrismaDepartmentRepository.create(this.options.database),
      organizations: this.options.memberDepartments,
      projects: this.options.projects,
    });
    const personalUsage = DefaultGovernancePersonalUsageService.create({
      reader: this.options.personalUsageReader,
    });
    const routingPolicies = DefaultGovernanceRoutingPolicyService.create({
      repository: PrismaRoutingPolicyRepository.create(this.options.database),
    });
    const personalVirtualKeys = DefaultGovernancePersonalVirtualKeyService.create({
      keys: this.options.gateway,
      providers: this.options.modelProviders,
      issuer: this.options.personalVirtualKeyIssuer,
      organizations: this.options.organizations,
      policies: routingPolicies,
      gatewayBaseUrl: this.options.gatewayBaseUrl,
    });
    const aiTools = DefaultGovernanceAiToolCatalogService.create({
      repository: PrismaAiToolCatalogRepository.create(this.options.database),
      slugs: this.options.aiToolSlugs,
      providers: this.options.aiToolProviders,
    });
    const activity = ActivityMonitorService.create(
      PrismaActivityMonitorRepository.create({
        prisma: this.options.database,
        clickhouse: this.options.activityClickhouse,
      }),
    );
    const ingestionCredentials = IngestionCredentialsService.create(
      this.options.ingestionEncryption,
    );
    const ingestionSources = IngestionSourceService.create({
      repository: PrismaIngestionSourceRepository.create(this.options.database),
      projects: this.options.projects,
      entitlements: this.options.ingestionSourceEntitlements,
      lifecycle: this.options.ingestionSourceLifecycle,
      credentials: ingestionCredentials,
      secrets: IngestionSecretService.create(
        IngestionSecretConfiguration.create({
          pepper: this.options.ingestionSecretPepper,
        }),
      ),
      destinations: PullDestinationService.create(),
      providerAccounts: HttpProviderAccountChannel.create({ credentials: ingestionCredentials }),
      diagnostics: this.options.ingestionDiagnostics,
    });

    const canonicalCost = CanonicalCostExtractorService.create();
    const policy = PostgresGovernanceAdapter.create({
      database: this.options.database,
    }).build().policy;
    const templateRepository = PrismaIngestionTemplateRepository.create(this.options.database);
    const ingestionKeys = PersonalIngestionKeyService.create({
      apiKeys: this.options.apiKeys,
      organizations: this.options.organizations,
      templates: templateRepository,
    });
    const templates = IngestionTemplateService.create({ repository: templateRepository });
    const ocsf = DefaultGovernanceOcsfExportService.create({
      repository: PrismaGovernanceOcsfExportRepository.create(this.options.database),
      events: this.options.ocsfEvents,
    });
    const cliBootstrap = DefaultGovernanceCliBootstrapService.create({
      catalog: aiTools,
      budgets: this.options.budgetOverview,
      contacts: this.options.cliContacts,
      gatewayUrl: this.options.gatewayBaseUrl,
    });
    const cliSessions = DefaultGovernanceCliSessionInventoryService.create({
      auth: this.options.auth,
      loginKeys: this.options.apiKeys,
    });
    const cliTokenRevocation = DefaultGovernanceCliTokenRevocationService.create({
      auth: this.options.auth,
    });
    const adminWorkspaceViewAudit = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository: PrismaAdminWorkspaceViewAuditRepository.create(this.options.database),
      teams: this.options.organizations,
      projects: this.options.projects,
      diagnostics: this.options.adminWorkspaceDiagnostics,
    });
    const quarantineFill = QuarantineFillEvaluatorService.create({
      tenant: this.options.quarantineTenant,
      traceActivity: this.options.quarantineTraceActivity,
      diagnostics: this.options.quarantineDiagnostics,
    });
    const setupState = DefaultGovernanceSetupStateService.create({
      repository: PrismaGovernanceSetupStateRepository.create(this.options.database),
      keys: this.options.gateway,
      projects: this.options.projects,
      activity: this.options.setupActivity,
    });

    const rules = GovernanceRulesOperationsService.create({
      anomalyRules,
      departments,
      policy,
      aiTools,
    });
    const ingestion = GovernanceIngestionOperationsService.create({
      canonicalCost,
      eventing: this.options.eventing,
      ingestionKeys,
      ingestionSources,
      templates,
      ocsf,
      ottl: this.options.ottl,
    });
    const activityOperations = GovernanceActivityOperationsService.create(
      activity,
      personalUsage,
      this.options.budgetOverview,
    );
    const lifecycle = GovernanceLifecycleOperationsService.create({
      routingPolicies,
      personalVirtualKeys,
      cliBootstrap,
      cliSessions,
      cliTokenRevocation,
      adminWorkspaceViewAudit,
      quarantineFill,
      setupState,
    });

    return DefaultGovernanceService.create({
      rules,
      ingestion,
      activity: activityOperations,
      lifecycle,
    });
  }
}
