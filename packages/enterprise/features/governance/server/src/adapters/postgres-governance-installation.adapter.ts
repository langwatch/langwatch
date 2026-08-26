// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type {
  GovernanceOttlGateway,
  GovernanceService,
} from "@langwatch/enterprise-governance-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import { CanonicalCostExtractorService } from "../services/canonical-cost-extractor.service";
import { GovernanceActivityService } from "../services/governance-activity.service";
import { GovernanceAiToolsService } from "../services/governance-ai-tools.service";
import { GovernanceDepartmentService } from "../services/governance-department.service";
import { PostgresAnomalyRuleAdapter } from "./postgres-anomaly-rule.adapter";
import { PostgresDepartmentAdapter } from "./postgres-department.adapter";
import { DefaultGovernanceCliBootstrapService } from "../services/cli-bootstrap.service";
import { DefaultGovernanceCliSessionInventoryService } from "../services/cli-session-inventory.service";
import { DefaultGovernanceCliTokenRevocationService } from "../services/cli-token-revocation.service";
import { DefaultGovernancePersonalUsageService } from "../services/personal-usage.service";
import { DefaultGovernanceService } from "../services/governance-facade.service";
import { GovernanceActivityOperationsService } from "../services/governance-activity-operations.service";
import { GovernanceIngestionOperationsService } from "../services/governance-ingestion-operations.service";
import { GovernanceLifecycleOperationsService } from "../services/governance-lifecycle-operations.service";
import { GovernanceRulesOperationsService } from "../services/governance-rules-operations.service";
import { IngestionKeyService } from "../services/ingestion-source-key.service";
import { IngestionCredentialsService } from "../services/ingestion-credentials.service";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../services/ingestion-source-secret.service";
import { PullDestinationService } from "../services/pull-destination.service";
import { PostgresAdminWorkspaceViewAuditAdapter } from "./postgres-admin-workspace-view-audit.adapter";
import { PostgresAiToolCatalogAdapter } from "./postgres-ai-tool-catalog.adapter";
import {
  PostgresGovernanceAdapter,
  type GovernanceDatabase,
} from "./postgres-governance.adapter";
import { PostgresGovernanceOcsfExportAdapter } from "./postgres-ocsf-export.adapter";
import { PostgresGovernanceSetupStateAdapter } from "./postgres-governance-setup-state.adapter";
import { PostgresIngestionTemplateAdapter } from "./postgres-ingestion-template.adapter";
import { PostgresIngestionSourceActivityAdapter } from "./postgres-ingestion-source-activity.adapter";
import { PostgresIngestionSourceAdapter } from "./postgres-ingestion-source.adapter";
import { PostgresPersonalVirtualKeyAdapter } from "./postgres-governance-personal-key.adapter";
import { PostgresRoutingPolicyAdapter } from "./postgres-governance-routing.adapter";
import type { AdminWorkspaceViewOcsfPort } from "../ports/admin-workspace-view-audit.port";
import type {
  AiToolProviderCatalogPort,
  AiToolSlugPort,
} from "../ports/ai-tool-catalog.port";
import type { CliAdminContactPort } from "../ports/cli-bootstrap.port";
import type { CliTokenStorePort } from "../ports/cli-token-store.port";
import { GovernanceBudgetOverviewPort } from "../ports/governance-budget-overview.port";
import type { GovernanceDiagnosticsPort } from "../ports/governance-diagnostics.port";
import type { GovernanceEncryptionPort } from "../ports/governance-encryption.port";
import type { GovernanceEventingPort } from "../ports/governance-eventing.port";
import type { GovernanceOcsfEventsReaderPort } from "../ports/ocsf-export.port";
import type { GovernanceSetupActivityPort } from "../ports/governance-setup-state.port";
import type { GovernanceClickHouseResolverPort } from "../ports/ingestion-source-activity.port";
import type {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
} from "../ports/ingestion-source.port";
import type {
  IngestionKeyIssuerPort,
  IngestionKeyRepository,
} from "../ports/ingestion-source-key.port";
import type { PersonalUsageReaderPort } from "../ports/personal-usage.port";
import type { PersonalVirtualKeyIssuerPort } from "../ports/personal-virtual-key.port";
import type {
  QuarantineTenantPort,
  QuarantineTraceActivityPort,
} from "../ports/quarantine-fill.port";
import { QuarantineFillEvaluatorService } from "../services/quarantine-fill.service";

/**
 * The sole server-side installation boundary for Governance. The app supplies
 * infrastructure and neighbouring feature services; this adapter owns all
 * Governance repositories and collaborating service construction.
 */
export type GovernanceInstallationOptions = {
  database: GovernanceDatabase;
  organizations: OrganizationService;
  projects: ProjectService;
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

/** Builds the one process-owned GovernanceService from injected infrastructure. */
export class PostgresGovernanceInstallationAdapter {
  private constructor(private readonly options: GovernanceInstallationOptions) {}

  static create(
    options: GovernanceInstallationOptions,
  ): PostgresGovernanceInstallationAdapter {
    return new PostgresGovernanceInstallationAdapter(options);
  }

  build(): GovernanceService {
    const anomalyRules = PostgresAnomalyRuleAdapter.create({
      database: this.options.database,
    }).build();
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
    const aiTools = PostgresAiToolCatalogAdapter.create({
      database: this.options.database,
      slugs: this.options.aiToolSlugs,
      providers: this.options.aiToolProviders,
    }).build();
    const activity = PostgresIngestionSourceActivityAdapter.create({
      database: this.options.database,
      clickhouse: this.options.activityClickhouse,
    }).build();
    const ingestionSources = PostgresIngestionSourceAdapter.create({
      database: this.options.database,
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
    }).build();

    const canonicalCost = CanonicalCostExtractorService.create();
    const governanceActivity = GovernanceActivityService.create(activity);
    const governanceAiTools = GovernanceAiToolsService.create(aiTools);
    const governanceDepartments = GovernanceDepartmentService.create(departments);
    const policy = PostgresGovernanceAdapter.create({
      database: this.options.database,
    }).build().policy;
    const ingestionKeys = IngestionKeyService.create({
      repository: this.options.ingestionKeyRepository,
      issuer: this.options.ingestionKeyIssuer,
      organizations: this.options.organizations,
    });
    const templates = PostgresIngestionTemplateAdapter.create({
      database: this.options.database,
    }).build();
    const ocsf = PostgresGovernanceOcsfExportAdapter.create({
      database: this.options.database,
      events: this.options.ocsfEvents,
    }).build();
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
    const adminWorkspaceViewAudit = PostgresAdminWorkspaceViewAuditAdapter.create({
      database: this.options.database,
      projects: this.options.projects,
      ocsf: this.options.adminWorkspaceOcsf,
      diagnostics: this.options.adminWorkspaceDiagnostics,
    }).build();
    const quarantineFill = QuarantineFillEvaluatorService.create({
      tenant: this.options.quarantineTenant,
      traceActivity: this.options.quarantineTraceActivity,
      diagnostics: this.options.quarantineDiagnostics,
    });
    const setupState = PostgresGovernanceSetupStateAdapter.create({
      database: this.options.database,
      activity: this.options.setupActivity,
    }).build();

    const rules = GovernanceRulesOperationsService.create(
      anomalyRules,
      governanceDepartments,
      policy,
      governanceAiTools,
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
      governanceActivity,
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

    return DefaultGovernanceService.create(
      rules,
      ingestion,
      activityOperations,
      lifecycle,
    );
  }
}
