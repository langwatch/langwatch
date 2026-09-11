// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export {
  PrismaGovernanceRepository as PostgresGovernanceAdapter,
  type PostgresGovernanceServices,
} from "./repositories/prisma/prisma.governance.repository.ts";

export { PrismaGovernanceDirectoryRepository } from "./repositories/prisma/prisma.governance-directory.repository.ts";
export { PrismaOrganizationSupportContactRepository } from "./repositories/prisma/prisma.organization-support-contact.repository.ts";

export {
  GovernanceDirectory,
  type GovernanceDirectoryProject,
  type GovernanceMembershipStatus,
} from "./repositories/directory/governance-directory.repository.ts";
export type { PersonalUsageRollup } from "./services/personal-usage-dashboard.service.ts";
/**
 * The landing decision, re-exported beside the service it gathers signals from.
 */
export {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
export {
  PrismaGovernanceInstallationRepository as PostgresGovernanceInstallationAdapter,
  type GovernanceInstallationOptions,
} from "./repositories/prisma/prisma.governance-installation.repository.ts";

/**
 * The feature's application: the one typed thing its transports are given.
 * Every door reaches the same object, so a rule written on it is the rule
 * every door gets.
 */
export {
  GovernanceApp,
  NoEligibleModelProvidersError,
  PersonalVirtualKeyLabelTakenError,
  PersonalVirtualKeyMissingError,
  RoutingPolicyEmptyError,
  RoutingPolicyModelNotConcreteError,
  RoutingPolicyProviderRequiredError,
  RoutingPolicyScopeRequiredError,
  type GovernanceActorDirectory,
  type GovernanceActorUser,
  type GovernanceAppDependencies,
  type GovernanceCaller,
  type GovernancePersonalVirtualKeyMembers,
  type GovernanceProjectCaller,
} from "./app/governance.app.ts";

// Process and eventing boundaries. Domain collaborators remain private to the
// installation adapter and are never application capabilities.
export * from "./services/governance-events.service.ts";
export * from "./app/governance.members.ts";
export * from "./repositories/audit/admin-workspace-view-audit.repository.ts";
export * from "./repositories/ai-tool-catalog.repository.ts";
export * from "./repositories/policy/anomaly-rule.repository.ts";
export * from "./repositories/directory/department.repository.ts";
export * from "./services/governance-diagnostics.service.ts";
export * from "./repositories/audit/governance-setup-state.repository.ts";
export * from "./app/governance.members.ts";
export * from "./repositories/ingestion-pull-lifecycle.repository.ts";
export * from "./services/ingestion-pull-diagnostics.service.ts";
export * from "./repositories/ingestion-source.repository.ts";
export * from "./repositories/ingestion-template.repository.ts";
export * from "./repositories/directory/personal-virtual-key.repository.ts";
export * from "./repositories/policy/routing-policy.repository.ts";
export * from "./repositories/policy/session-policy.repository.ts";
export * from "./repositories/policy/spend-spike-anomaly.repository.ts";
export {
  AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
  AUTOMATION_MATCH_RECORDS_METRIC_NAME,
  OtelTraceAlertMetricsAdapter,
} from "./services/otel.trace-alert-metrics.service.ts";

export { IngestionPullEventingAdapter } from "./services/ingestion-pull-eventing.service.ts";
export { SEAT_REPORT_ACTION } from "./services/microsoftGraphSeats.ts";
export { PrismaSpendSpikeAnomalyRepository } from "./repositories/prisma/prisma.spend-spike-anomaly.repository.ts";
export type { SpendSpikeAnomalyDatabase } from "./repositories/prisma/prisma.spend-spike-anomaly.repository.ts";
export { PrismaIngestionPullLifecycleRepository } from "./repositories/prisma/prisma.ingestion-pull-lifecycle.repository.ts";
export { PrismaIngestionPullSourceRepository as PostgresIngestionPullSourceAdapter } from "./repositories/prisma/prisma.ingestion-pull-source.repository.ts";
export type { IngestionSourceDatabase } from "./repositories/prisma/prisma.ingestion-source.repository.ts";
export { PrismaIngestionPullRunProjectionRepository } from "./repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";
export type { IngestionPullRunProjectionDatabase } from "./repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";
export { PulledUsageEventingAdapter } from "./services/pulled-usage-eventing.service.ts";

export {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "./processes/gateway-debit.process.ts";
export { GovernanceEventDeliveryProcess } from "./processes/governance-event-delivery.process.ts";
export { IngestionPullProcess } from "./processes/ingestion-pull.process.ts";
export { PulledUsageLedgerProcess } from "./processes/pulled-usage-ledger.process.ts";

export { BuiltInPullerRegistryService } from "./services/built-in-puller-registry.service.ts";
export { PullerRegistryService } from "./services/puller-registry.service.ts";
export { AnthropicAdminPullerAdapter } from "./services/anthropic-admin-puller.service.ts";
export { ClaudeComplianceReferencePullerAdapter } from "./services/claude-compliance-puller.service.ts";
export { CopilotStudioReferencePullerAdapter } from "./services/copilot-studio-puller.service.ts";
export { CopilotStudioDataversePullerAdapter } from "./services/copilot-studio-dataverse-puller.service.ts";
export { DatabricksGeniePullerAdapter } from "./services/databricks-genie-puller.service.ts";
export { HttpPollingPullerAdapter } from "./services/http-poller.service.ts";
export { OpenAiComplianceReferencePullerAdapter } from "./services/openai-compliance-puller.service.ts";
export { OpenAiAdminPullerAdapter } from "./services/openai-admin-puller.service.ts";
export { S3PollingPullerAdapter } from "./services/s3-puller.service.ts";
export { AnomalyRuleService } from "./services/anomaly-rule.service.ts";
export { DepartmentService } from "./services/department.service.ts";
export { SpendSpikeAnomalyEvaluatorService } from "./services/spend-spike-anomaly-evaluator.service.ts";
export { AnomalyAlertDispatcherService } from "./services/anomaly-alert-dispatcher.service.ts";
export { GovernanceSignalService } from "./services/governance-signal.service.ts";
export { IngestionCredentialsService } from "./services/ingestion-credentials.service.ts";
export { IngestionSecretConfiguration } from "./services/ingestion-source-secret.service.ts";
export { IngestionSecretService } from "./services/ingestion-source-secret.service.ts";
export { IngestionPullLifecycleService } from "./services/ingestion-pull-lifecycle.service.ts";
export { IngestionPullService } from "./services/ingestion-pull.service.ts";
export { IngestionPullWorkerService } from "./services/ingestion-pull-worker.service.ts";
export { PullDestinationService } from "./services/pull-destination.service.ts";
export { PulledUsagePricingService } from "./services/pulled-usage-pricing.service.ts";
export { PulledUsageRecordService } from "./services/pulled-usage-record.service.ts";
export {
  OrganizationSessionPolicyService,
  SESSION_POLICY_MAX_DAYS,
  SessionPolicyOutOfRangeError,
} from "./services/organization-session-policy.service.ts";
export { PrismaSessionPolicyRepository as PostgresSessionPolicyAdapter } from "./repositories/prisma/prisma.session-policy.repository.ts";
export { GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS } from "./subscribers/governance-ocsf.subscriber.ts";
export {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
} from "./subscribers/governance-kpis.subscriber.ts";
export { GovernanceOcsfSubscriber } from "./subscribers/governance-ocsf.subscriber.ts";
export { TraceAlertTriggerMatchSubscriber } from "./subscribers/trace-alert-trigger-match.subscriber.ts";

// The thirteen tRPC transports this feature owns are not exported: they still
// name the deleted legacy builder, so nothing may reach them until each is
// converted to the declared `defineTrpcRouter` shape.

/**
 * The public REST family this feature owns. The process supplies the bound REST security
 * service and resolvers for the governance and project services; the base path, access
 * declarations, schemas and delegation are the feature's.
 */
export { createGovernanceRestApp } from "./transport/api-rest/governance.api.ts";

// The CLI governance plane: thirteen routes under `/api/auth/cli` that
// authenticate with a device-session bearer and dispatch into governance. They
// sit under an auth path because the project-scoped governance REST rejects a
// device token; the services underneath are the console's own.
export {
  createGovernanceCliRestApp,
  type GovernanceCliAccessToken,
  type GovernanceCliBudgetReader as GovernanceCliBudget,
  type GovernanceCliCaller,
  type GovernanceCliPersonalWorkspace,
  type GovernanceCliRestDependencies as GovernanceCliRestMembers,
} from "./transport/api-rest/governance-cli.api.ts";

// The Activity Monitor's push-mode receivers. A signal whose collection this
// process did not compose is not mounted at all, so an exporter gets a 404
// rather than a 500 from a receiver that pretends to serve it.
export {
  createGovernanceIngestRestApp,
  type GovernanceIngestLogCollectionChannel as GovernanceIngestLogCollection,
  type GovernanceIngestMetricCollectionChannel as GovernanceIngestMetricCollection,
  type GovernanceIngestRestMembers,
  type GovernanceIngestSpend,
  type GovernanceIngestTraceCollection,
} from "./transport/api-rest/governance-ingest.api.ts";
export {
  GovernanceIngestRateLimiter,
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "./services/governance-ingest-rate-limit.service.ts";
export { OrganizationSupportContactService } from "./services/organization-support-contact.service.ts";

/**
 * The governance tools installed on a hosted MCP session. Exported from here, and not from the
 * hosted MCP endpoint, because a core feature package may not depend on an Enterprise one. The
 * process that has both registers these through the endpoint's session-tool seam.
 */
export {
  GovernanceMcpPermissionProbe,
  registerGovernanceMcpTools,
  type GovernanceMcpContext,
} from "./transport/api-mcp/governance-tools.api.ts";
