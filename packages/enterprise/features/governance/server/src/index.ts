// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export { PostgresGovernanceDirectoryAdapter } from "./adapters/postgres.governance-directory.adapter.ts";
export { PostgresOrganizationSupportContactAdapter } from "./adapters/postgres.organization-support-contact.adapter.ts";

export {
  GovernanceDirectoryPort,
  type GovernanceDirectoryProject,
  type GovernanceMembershipStatus,
} from "./ports/governance-directory.port.ts";
export { GovernanceService } from "@langwatch/enterprise-governance-contract";
/**
 * The landing decision, re-exported beside the service it gathers signals from.
 */
export {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
export {
  PostgresGovernanceInstallationAdapter,
  type GovernanceInstallationOptions,
} from "./adapters/postgres.governance-installation.adapter.ts";

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
  type GovernancePersonalVirtualKeyPorts,
  type GovernanceProjectCaller,
} from "./app/governance.app.ts";

// Process and eventing boundaries. Domain collaborators remain private to the
// installation adapter and are never application capabilities.
export * from "./adapters/governance-events.adapter.ts";
export * from "./ports/gateway-debit.port.ts";
export * from "./ports/governance-budget-overview.port.ts";
export * from "./ports/governance-eventing.port.ts";
export * from "./ports/ingestion-source-activity.port.ts";
export * from "./ports/admin-workspace-view-audit.port.ts";
export * from "./ports/ai-tool-catalog.port.ts";
export * from "./ports/cli-bootstrap.port.ts";
export * from "./ports/cli-token-store.port.ts";
export * from "./ports/anomaly-rule.port.ts";
export * from "./ports/department.port.ts";
export * from "./ports/anomaly-alert-http.port.ts";
export * from "./ports/governance-diagnostics.port.ts";
export * from "./ports/governance-encryption.port.ts";
export * from "./ports/governance-http.port.ts";
export * from "./ports/governance-object-storage.port.ts";
export * from "./ports/governance-signal.port.ts";
export * from "./ports/governance-setup-state.port.ts";
export * from "./ports/governance-webhook.port.ts";
export * from "./ports/ingestion-pull.port.ts";
export * from "./ports/ingestion-pull-lifecycle.port.ts";
export * from "./ports/ingestion-pull-worker.port.ts";
export * from "./ports/ingestion-source.port.ts";
export * from "./ports/ingestion-template.port.ts";
export * from "./ports/ocsf-export.port.ts";
export * from "./ports/ingestion-source-key.port.ts";
export * from "./ports/personal-usage.port.ts";
export * from "./ports/personal-virtual-key.port.ts";
export * from "./ports/pulled-usage-ledger.port.ts";
export * from "./ports/pulled-usage-rate.port.ts";
export * from "./ports/quarantine-fill.port.ts";
export * from "./ports/routing-policy.port.ts";
export * from "./ports/session-policy.port.ts";
export * from "./ports/spend-spike-anomaly.port.ts";
export * from "./ports/governance-subscriber.port.ts";
export {
  AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
  AUTOMATION_MATCH_RECORDS_METRIC_NAME,
  OtelTraceAlertMetricsAdapter,
} from "./adapters/otel.trace-alert-metrics.adapter.ts";

export { IngestionPullEventingAdapter } from "./adapters/ingestion-pull.adapter.ts";
export { PostgresAnomalyRuleAdapter } from "./adapters/postgres.anomaly-rule.adapter.ts";
export { PostgresDepartmentAdapter } from "./adapters/postgres.department.adapter.ts";
export { PostgresSpendSpikeAnomalyAdapter } from "./adapters/postgres.spend-spike-anomaly.adapter.ts";
export type { SpendSpikeAnomalyDatabase } from "./repositories/prisma/prisma.spend-spike-anomaly.repository.ts";
export { PostgresIngestionSourceActivityAdapter } from "./adapters/postgres.ingestion-source-activity.adapter.ts";
export { PostgresIngestionSourceAdapter } from "./adapters/postgres.ingestion-source.adapter.ts";
export { PostgresIngestionPullLifecycleAdapter } from "./adapters/postgres.ingestion-pull-lifecycle.adapter.ts";
export { PostgresIngestionPullSourceAdapter } from "./adapters/postgres.ingestion-pull-source.adapter.ts";
export type { IngestionSourceDatabase } from "./repositories/prisma/prisma.ingestion-source.repository.ts";
export { PostgresIngestionPullRunProjectionAdapter } from "./adapters/postgres.ingestion-pull-run-projection.adapter.ts";
export type { IngestionPullRunProjectionDatabase } from "./repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";
export { PostgresIngestionTemplateAdapter } from "./adapters/postgres.ingestion-template.adapter.ts";
export { PulledUsageEventingAdapter } from "./adapters/pulled-usage.adapter.ts";

export {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "./processes/gateway-debit.process.ts";
export { GovernanceEventDeliveryProcess } from "./processes/governance-event-delivery.process.ts";
export { IngestionPullProcess } from "./processes/ingestion-pull.process.ts";
export { PulledUsageLedgerProcess } from "./processes/pulled-usage-ledger.process.ts";

export { BuiltInPullerRegistryService } from "./services/built-in-puller-registry.service.ts";
export { PullerRegistryService } from "./services/puller-registry.service.ts";
export { AnthropicAdminPullerAdapter } from "./adapters/anthropic-admin-puller.adapter.ts";
export { ClaudeComplianceReferencePullerAdapter } from "./adapters/claude-compliance-puller.adapter.ts";
export { CopilotStudioReferencePullerAdapter } from "./adapters/copilot-studio-puller.adapter.ts";
export { CopilotStudioDataversePullerAdapter } from "./adapters/copilot-studio-dataverse-puller.adapter.ts";
export { DatabricksGeniePullerAdapter } from "./adapters/databricks-genie-puller.adapter.ts";
export { HttpPollingPullerAdapter } from "./adapters/http-poller.adapter.ts";
export { OpenAiComplianceReferencePullerAdapter } from "./adapters/openai-compliance-puller.adapter.ts";
export { OpenAiAdminPullerAdapter } from "./adapters/openai-admin-puller.adapter.ts";
export { S3PollingPullerAdapter } from "./adapters/s3-puller.adapter.ts";
export { AnomalyRuleService } from "./services/anomaly-rule.service.ts";
export { DepartmentService } from "./services/department.service.ts";
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
export { PostgresSessionPolicyAdapter } from "./adapters/postgres.session-policy.adapter.ts";
export { GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS } from "./subscribers/governance-ocsf.subscriber.ts";
export {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
} from "./subscribers/governance-kpis.subscriber.ts";
export { GovernanceOcsfSubscriber } from "./subscribers/governance-ocsf.subscriber.ts";
export { TraceAlertTriggerMatchSubscriber } from "./subscribers/trace-alert-trigger-match.subscriber.ts";

/**
 * The app-process tRPC transports this feature owns. The process supplies its
 * root, authenticated procedure and policy chain; the procedure names, input
 * schemas, access declarations and delegation are the feature's.
 */
export {
  PersonalVirtualKeyTrpcApi,
  type PersonalVirtualKeyTrpcContext,
} from "./transport/api-trpc/personal-virtual-key.api.ts";
export {
  RoutingPolicyTrpcApi,
  type RoutingPolicyTrpcContext,
} from "./transport/api-trpc/routing-policy.api.ts";
export {
  PersonalDashboardTrpcApi,
  type PersonalDashboardTrpcContext,
} from "./transport/api-trpc/personal-dashboard.api.ts";
export {
  PersonalSessionsTrpcApi,
  type PersonalSessionsTrpcContext,
} from "./transport/api-trpc/personal-sessions.api.ts";
export {
  SessionPolicyTrpcApi,
  type SessionPolicyTrpcContext,
} from "./transport/api-trpc/session-policy.api.ts";
export {
  IngestionKeyTrpcApi,
  type IngestionKeyTrpcContext,
} from "./transport/api-trpc/ingestion-key.api.ts";
export {
  DepartmentsTrpcApi,
  type DepartmentsTrpcContext,
} from "./transport/api-trpc/departments.api.ts";
export {
  IngestionTemplatesTrpcApi,
  type IngestionTemplatesTrpcContext,
} from "./transport/api-trpc/ingestion-templates.api.ts";
export {
  ActivityMonitorTrpcApi,
  type ActivityMonitorTrpcContext,
} from "./transport/api-trpc/activity-monitor.api.ts";
export {
  AnomalyRulesTrpcApi,
  type AnomalyRulesTrpcContext,
} from "./transport/api-trpc/anomaly-rules.api.ts";
export {
  GovernanceTrpcApi,
  type GovernanceTrpcContext,
} from "./transport/api-trpc/governance.api.ts";
export {
  IngestionSourcesTrpcApi,
  toIngestionSourceDto,
  type IngestionSourcesTrpcContext,
} from "./transport/api-trpc/ingestion-sources.api.ts";
export { AiToolsTrpcApi, type AiToolsTrpcContext } from "./transport/api-trpc/ai-tools.api.ts";

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
  type GovernanceCliAccessTokenPort,
  type GovernanceCliBudgetPort,
  type GovernanceCliCaller,
  type GovernanceCliPersonalWorkspace,
  type GovernanceCliRestPorts,
} from "./transport/api-rest/governance-cli.api.ts";

// The Activity Monitor's push-mode receivers. A signal whose collection this
// process did not compose is not mounted at all, so an exporter gets a 404
// rather than a 500 from a receiver that pretends to serve it.
export {
  createGovernanceIngestRestApp,
  type GovernanceIngestLogCollectionPort,
  type GovernanceIngestMetricCollectionPort,
  type GovernanceIngestRestPorts,
  type GovernanceIngestSpendPort,
  type GovernanceIngestTraceCollectionPort,
} from "./transport/api-rest/governance-ingest.api.ts";
export { GovernanceProjectPort } from "./ports/governance-project.port.ts";
export {
  GovernanceIngestRateLimitPort,
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "./ports/governance-ingest-rate-limit.port.ts";
export { OrganizationSupportContactService } from "./services/organization-support-contact.service.ts";

/**
 * The governance tools installed on a hosted MCP session. Exported from here, and not from the
 * hosted MCP endpoint, because a core feature package may not depend on an Enterprise one. The
 * process that has both registers these through the endpoint's session-tool seam.
 */
export {
  GovernanceMcpPermissionProbePort,
  registerGovernanceMcpTools,
  type GovernanceMcpContext,
} from "./transport/api-mcp/governance-tools.api.ts";
