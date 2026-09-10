// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  GovernanceOttlGateway,
  GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { CanonicalCostExtractorService } from "../services/canonical-cost-extractor.service.ts";
import { PostgresDepartmentAdapter } from "./postgres.department.adapter.ts";
import { DefaultGovernanceCliBootstrapService } from "../services/governance-cli-tool-bootstrap.service.ts";
import { DefaultGovernanceCliSessionInventoryService } from "../services/cli-session-inventory.service.ts";
import { DefaultGovernanceCliTokenRevocationService } from "../services/cli-token-revocation.service.ts";
import { DefaultGovernancePersonalUsageService } from "../services/personal-usage.service.ts";
import { DefaultGovernanceService } from "../services/governance-facade.service.ts";
import { GovernanceActivityOperationsService } from "../services/governance-activity-operations.service.ts";
import { GovernanceIngestionOperationsService } from "../services/governance-ingestion-operations.service.ts";
import { GovernanceLifecycleOperationsService } from "../services/governance-lifecycle-operations.service.ts";
import { GovernanceRulesOperationsService } from "../services/governance-rules-operations.service.ts";
import { IngestionKeyService } from "../services/ingestion-source-key.service.ts";
import { IngestionCredentialsService } from "../services/ingestion-credentials.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../services/ingestion-source-secret.service.ts";
import { PullDestinationService } from "../services/pull-destination.service.ts";
import { PostgresGovernanceAdapter } from "./postgres.governance.adapter.ts";
import { PostgresIngestionSourceActivityAdapter } from "./postgres.ingestion-source-activity.adapter.ts";
import { PostgresPersonalVirtualKeyAdapter } from "./postgres.governance-personal-key.adapter.ts";
import { PostgresRoutingPolicyAdapter } from "./postgres.governance-routing.adapter.ts";
import type { AdminWorkspaceViewOcsfPort } from "../app/governance.infrastructure.ts";
import type { AiToolProviderCatalogPort, AiToolSlugPort } from "../ports/ai-tool-catalog.port.ts";
import type { CliAdminContactPort } from "../app/governance.infrastructure.ts";
import type { CliTokenStorePort } from "../app/governance.infrastructure.ts";
import { GovernanceBudgetOverviewPort } from "../ports/governance-budget-overview.port.ts";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port.ts";
import type { GovernanceEncryptionPort } from "../app/governance.infrastructure.ts";
import type { GovernanceEventingPort } from "../app/governance.infrastructure.ts";
import type { GovernanceOcsfEventsReaderPort } from "../app/governance.infrastructure.ts";
import type { GovernanceSetupActivityPort } from "../app/governance.infrastructure.ts";
import type { GovernanceClickHouseResolverPort } from "../ports/ingestion-source-activity.port.ts";
import type {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
} from "../ports/ingestion-source.port.ts";
import type {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
} from "../ports/ingestion-source-key.port.ts";
import type { PersonalUsageReaderPort } from "../ports/personal-usage.port.ts";
import type { PersonalVirtualKeyIssuerPort } from "../ports/personal-usage.port.ts";
import type {
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
} from "../ports/quarantine-fill.port.ts";
import { QuarantineFillEvaluatorService } from "../services/quarantine-fill.service.ts";

/**
 * The sole server-side installation boundary for Governance. The app supplies
 * infrastructure and neighbouring feature services; this adapter owns all
 * Governance repositories and collaborating service construction.
 */
export type GovernanceInstallationOptions = {
  database: PrismaClient;
  organizations: OrganizationService;
  projects: ProjectApi;
  gatewayBaseUrl: string;
  eventing: GovernanceEventingPort;
  activityClickhouse: GovernanceClickHouseResolverPort;
  ingestionSourceEntitlements: IngestionSourceEntitlementsPort;
  ingestionSourceLifecycle: IngestionSourceLifecyclePort;
  ingestionEncryption: GovernanceEncryptionPort;
  ingestionSecretPepper: string;
  ingestionDiagnostics: GovernanceDiagnosticsPort;
  personalUsageReader?: PersonalUsageReaderPort;
  personalVirtualKeyIssuer: PersonalVirtualKeyIssuerPort;
  budgetOverview: GovernanceBudgetOverviewPort;
  aiToolSlugs: AiToolSlugPort;
  aiToolProviders: AiToolProviderCatalogPort;
  cliContacts: CliAdminContactPort;
  cliTokenStore?: CliTokenStorePort;
  diagnostics?: GovernanceDiagnosticsPort;
  adminWorkspaceOcsf?: AdminWorkspaceViewOcsfPort;
  adminWorkspaceDiagnostics?: GovernanceDiagnosticsPort;
  quarantineTenant: QuarantineTenantPort;
  quarantineTraceActivity?: QuarantineTraceActivityPort;
  quarantineDiagnostics?: GovernanceDiagnosticsPort;
  setupActivity?: GovernanceSetupActivityPort;
  ocsfEvents?: GovernanceOcsfEventsReaderPort;
  ingestionKeyRepository: IngestionKeyRepository;
  ingestionKeyIssuer: IngestionKeyIssuerPort;
  ottl: GovernanceOttlGateway;
};

import { PrismaAdminWorkspaceViewAuditRepository } from "../repositories/prisma/prisma.admin-workspace-view-audit.repository.ts";
import { PrismaAiToolCatalogRepository } from "../repositories/prisma/prisma.ai-tool-catalog.repository.ts";
import { PrismaAnomalyRuleRepository } from "../repositories/prisma/prisma.anomaly-rule.repository.ts";
import { PrismaGovernanceOcsfExportRepository } from "../repositories/prisma/prisma.ocsf-export.repository.ts";
import { PrismaGovernanceSetupStateRepository } from "../repositories/prisma/prisma.governance-setup-state.repository.ts";
import { PrismaIngestionSourceRepository } from "../repositories/prisma/prisma.ingestion-source.repository.ts";
import { PrismaIngestionTemplateRepository } from "../repositories/prisma/prisma.ingestion-template.repository.ts";
import { AnomalyRuleService } from "../services/anomaly-rule.service.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../services/admin-workspace-view-audit.service.ts";
import { DefaultGovernanceAiToolCatalogService } from "../services/ai-tool-catalog.service.ts";
import { DefaultGovernanceOcsfExportService } from "../services/ocsf-export.service.ts";
import { DefaultGovernanceSetupStateService } from "../services/governance-setup-state.service.ts";
import { IngestionSourceService } from "../services/ingestion-source.service.ts";
import { IngestionTemplateService } from "../services/ingestion-template.service.ts";

/** Builds the one process-owned GovernanceApi from injected infrastructure. */
export class PostgresGovernanceInstallationAdapter {
  private constructor(private readonly options: GovernanceInstallationOptions) {}

  static create(options: GovernanceInstallationOptions): PostgresGovernanceInstallationAdapter {
    return new PostgresGovernanceInstallationAdapter(options);
  }

  build(): GovernanceApi {
    const anomalyRules = AnomalyRuleService.create({
      repository: PrismaAnomalyRuleRepository.create(this.options.database),
    });
    const departments = PostgresDepartmentAdapter.create({
      database: this.options.database,
    }).build();
    const personalUsage = DefaultGovernancePersonalUsageService.create({
      reader: this.options.personalUsageReader,
    });
    const routingPolicies = PostgresRoutingPolicyAdapter.create({
      database: this.options.database,
    }).build();
    const personalVirtualKeys = PostgresPersonalVirtualKeyAdapter.create({
      database: this.options.database,
      issuer: this.options.personalVirtualKeyIssuer,
      organizations: this.options.organizations,
      policies: routingPolicies,
      gatewayBaseUrl: this.options.gatewayBaseUrl,
    }).build();
    const aiTools = DefaultGovernanceAiToolCatalogService.create({
      repository: PrismaAiToolCatalogRepository.create(this.options.database),
      slugs: this.options.aiToolSlugs,
      providers: this.options.aiToolProviders,
    });
    const activity = PostgresIngestionSourceActivityAdapter.create({
      database: this.options.database,
      clickhouse: this.options.activityClickhouse,
    }).build();
    const ingestionSources = IngestionSourceService.create({
      repository: PrismaIngestionSourceRepository.create(this.options.database),
      projects: this.options.projects,
      entitlements: this.options.ingestionSourceEntitlements,
      lifecycle: this.options.ingestionSourceLifecycle,
      credentials: IngestionCredentialsService.create(this.options.ingestionEncryption),
      secrets: IngestionSecretService.create(
        IngestionSecretConfiguration.create({
          pepper: this.options.ingestionSecretPepper,
        }),
      ),
      destinations: PullDestinationService.create(),
      diagnostics: this.options.ingestionDiagnostics,
    });

    const canonicalCost = CanonicalCostExtractorService.create();
    const policy = PostgresGovernanceAdapter.create({
      database: this.options.database,
    }).build().policy;
    const ingestionKeys = IngestionKeyService.create({
      repository: this.options.ingestionKeyRepository,
      issuer: this.options.ingestionKeyIssuer,
      organizations: this.options.organizations,
    });
    const templates = IngestionTemplateService.create({
      repository: PrismaIngestionTemplateRepository.create(this.options.database),
    });
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
      store: this.options.cliTokenStore,
      diagnostics: this.options.diagnostics,
    });
    const cliTokenRevocation = DefaultGovernanceCliTokenRevocationService.create({
      store: this.options.cliTokenStore,
      diagnostics: this.options.diagnostics,
    });
    const adminWorkspaceViewAudit = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      repository: PrismaAdminWorkspaceViewAuditRepository.create(this.options.database),
      projects: this.options.projects,
      ocsf: this.options.adminWorkspaceOcsf,
      diagnostics: this.options.adminWorkspaceDiagnostics,
    });
    const quarantineFill = QuarantineFillEvaluatorService.create({
      tenant: this.options.quarantineTenant,
      traceActivity: this.options.quarantineTraceActivity,
      diagnostics: this.options.quarantineDiagnostics,
    });
    const setupState = DefaultGovernanceSetupStateService.create({
      repository: PrismaGovernanceSetupStateRepository.create(this.options.database),
      activity: this.options.setupActivity,
    });

    const rules = GovernanceRulesOperationsService.create(
      anomalyRules,
      departments,
      policy,
      aiTools,
    );
    const ingestion = GovernanceIngestionOperationsService.create(
      canonicalCost,
      this.options.eventing,
      ingestionKeys,
      ingestionSources,
      templates,
      ocsf,
      this.options.ottl,
    );
    const activityOperations = GovernanceActivityOperationsService.create(
      activity,
      personalUsage,
      this.options.budgetOverview,
    );
    const lifecycle = GovernanceLifecycleOperationsService.create(
      routingPolicies,
      personalVirtualKeys,
      cliBootstrap,
      cliSessions,
      cliTokenRevocation,
      adminWorkspaceViewAudit,
      quarantineFill,
      setupState,
    );

    return DefaultGovernanceService.create(rules, ingestion, activityOperations, lifecycle);
  }
}
