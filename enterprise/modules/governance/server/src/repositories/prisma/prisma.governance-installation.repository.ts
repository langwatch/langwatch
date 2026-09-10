// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type {
  GovernanceOttlGateway,
  GovernanceApi,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { CanonicalCostExtractorService } from "../../services/canonical-cost-extractor.service.ts";
import { DepartmentService } from "../../services/department.service.ts";
import { PrismaDepartmentRepository } from "./prisma.department.repository.ts";
import { DefaultGovernanceCliBootstrapService } from "../../services/governance-cli-tool-bootstrap.service.ts";
import { DefaultGovernanceCliSessionInventoryService } from "../../services/cli-session-inventory.service.ts";
import { DefaultGovernanceCliTokenRevocationService } from "../../services/cli-token-revocation.service.ts";
import { DefaultGovernancePersonalUsageService } from "../../services/personal-usage.service.ts";
import { DefaultGovernanceService } from "../../services/governance-facade.service.ts";
import { GovernanceActivityOperationsService } from "../../services/governance-activity-operations.service.ts";
import { GovernanceIngestionOperationsService } from "../../services/governance-ingestion-operations.service.ts";
import { GovernanceLifecycleOperationsService } from "../../services/governance-lifecycle-operations.service.ts";
import { GovernanceRulesOperationsService } from "../../services/governance-rules-operations.service.ts";
import { IngestionKeyService } from "../../services/ingestion-source-key.service.ts";
import { IngestionCredentialsService } from "../../services/ingestion-credentials.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../../services/ingestion-source-secret.service.ts";
import { PullDestinationService } from "../../services/pull-destination.service.ts";
import { PrismaGovernanceRepository } from "./prisma.governance.repository.ts";
import { ActivityMonitorService } from "../../services/ingestion-source-activity.service.ts";
import { PrismaActivityMonitorRepository } from "./prisma.ingestion-source-activity.repository.ts";
import { DefaultGovernancePersonalVirtualKeyService } from "../../services/governance-personal-key.service.ts";
import { PrismaPersonalVirtualKeyRepository } from "./prisma.governance-personal-key.repository.ts";
import { DefaultGovernanceRoutingPolicyService } from "../../services/governance-routing.service.ts";
import { PrismaRoutingPolicyRepository } from "./prisma.governance-routing.repository.ts";
import type { AdminWorkspaceViewOcsfChannel } from "../../app/governance.members.ts";
import type { AiToolProviderCatalog, AiToolSlug } from "../ai-tool-catalog.repository.ts";
import type { CliAdminContactReader } from "../../app/governance.members.ts";
import type { CliTokenStore } from "../../app/governance.members.ts";
import type { CliBudgetOverviewReader } from "../../app/governance.members.ts";
import type { GovernanceDiagnosticsSink } from "../../app/governance.members.ts";
import type { GovernanceEncryptor } from "../../app/governance.members.ts";
import type { GovernanceEventingChannel } from "../../app/governance.members.ts";
import type { GovernanceOcsfEventsReader } from "../../app/governance.members.ts";
import type { GovernanceSetupActivityReader } from "../../app/governance.members.ts";
import type { GovernanceClickHouseResolver } from "../../app/governance.members.ts";
import type {
  IngestionSourceEntitlements,
  IngestionSourceLifecycleChannel,
} from "../../app/governance.members.ts";
import type {
  IngestionKeyIssuer,
  IngestionKeyRepository,
} from "../../app/governance.members.ts";
import type { PersonalUsageReader } from "../../app/governance.members.ts";
import type { PersonalVirtualKeyIssuer } from "../../app/governance.members.ts";
import type {
  QuarantineTenantResolver,
  QuarantineTraceActivityReader,
} from "../../app/governance.members.ts";
import { QuarantineFillEvaluatorService } from "../../services/quarantine-fill.service.ts";

/**
 * The sole server-side installation boundary for Governance. The app supplies
 * members and neighbouring feature services; this adapter owns all
 * Governance repositories and collaborating service construction.
 */
export type GovernanceInstallationOptions = {
  database: PrismaClient;
  organizations: OrganizationService;
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
  budgetOverview: CliBudgetOverviewReader;
  aiToolSlugs: AiToolSlug;
  aiToolProviders: AiToolProviderCatalog;
  cliContacts: CliAdminContactReader;
  cliTokenStore?: CliTokenStore;
  diagnostics?: GovernanceDiagnosticsSink;
  adminWorkspaceOcsf?: AdminWorkspaceViewOcsfChannel;
  adminWorkspaceDiagnostics?: GovernanceDiagnosticsSink;
  quarantineTenant: QuarantineTenantResolver;
  quarantineTraceActivity?: QuarantineTraceActivityReader;
  quarantineDiagnostics?: GovernanceDiagnosticsSink;
  setupActivity?: GovernanceSetupActivityReader;
  ocsfEvents?: GovernanceOcsfEventsReader;
  ingestionKeyRepository: IngestionKeyRepository;
  ingestionKeyIssuer: IngestionKeyIssuer;
  ottl: GovernanceOttlGateway;
};

import { PrismaAdminWorkspaceViewAuditRepository } from "./prisma.admin-workspace-view-audit.repository.ts";
import { PrismaAiToolCatalogRepository } from "./prisma.ai-tool-catalog.repository.ts";
import { PrismaAnomalyRuleRepository } from "./prisma.anomaly-rule.repository.ts";
import { PrismaGovernanceOcsfExportRepository } from "./prisma.ocsf-export.repository.ts";
import { PrismaGovernanceSetupStateRepository } from "./prisma.governance-setup-state.repository.ts";
import { PrismaIngestionSourceRepository } from "./prisma.ingestion-source.repository.ts";
import { PrismaIngestionTemplateRepository } from "./prisma.ingestion-template.repository.ts";
import { AnomalyRuleService } from "../../services/anomaly-rule.service.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../../services/admin-workspace-view-audit.service.ts";
import { DefaultGovernanceAiToolCatalogService } from "../../services/ai-tool-catalog.service.ts";
import { DefaultGovernanceOcsfExportService } from "../../services/ocsf-export.service.ts";
import { DefaultGovernanceSetupStateService } from "../../services/governance-setup-state.service.ts";
import { IngestionSourceService } from "../../services/ingestion-source.service.ts";
import { IngestionTemplateService } from "../../services/ingestion-template.service.ts";

/** Builds the one process-owned GovernanceApi from injected members. */
export class PrismaGovernanceInstallationRepository {
  private constructor(private readonly options: GovernanceInstallationOptions) {}

  static create(options: GovernanceInstallationOptions): PrismaGovernanceInstallationRepository {
    return new PrismaGovernanceInstallationRepository(options);
  }

  build(): GovernanceApi {
    const anomalyRules = AnomalyRuleService.create({
      repository: PrismaAnomalyRuleRepository.create(this.options.database),
    });
    const departments = DepartmentService.create({
      repository: PrismaDepartmentRepository.create(this.options.database),
    });
    const personalUsage = DefaultGovernancePersonalUsageService.create({
      reader: this.options.personalUsageReader,
    });
    const routingPolicies = DefaultGovernanceRoutingPolicyService.create({
      repository: PrismaRoutingPolicyRepository.create(this.options.database),
    });
    const personalVirtualKeys = DefaultGovernancePersonalVirtualKeyService.create({
      repository: PrismaPersonalVirtualKeyRepository.create(this.options.database),
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
    const policy = PrismaGovernanceRepository.create({
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
