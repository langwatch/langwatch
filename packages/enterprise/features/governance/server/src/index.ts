export { GovernanceService } from "@langwatch/enterprise-governance-contract";
/**
 * The landing decision, re-exported beside the service it gathers signals from.
 *
 * A pure function of the contract's, surfaced through this package because the
 * process that gathers those signals reaches this vertical through one seam and
 * a second import path for the same decision is a second answer waiting to
 * happen.
 */
export {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
export {
  PostgresGovernanceInstallationAdapter,
  type GovernanceInstallationOptions,
} from "./adapters/postgres.governance-installation.adapter";

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
  type GovernanceActorWorkspace,
  type GovernanceAppDependencies,
  type GovernanceCaller,
  type GovernancePersonalVirtualKeyPorts,
  type GovernanceProjectCaller,
} from "./app/governance.app";

// Process and eventing boundaries. Domain collaborators remain private to the
// installation adapter and are never application capabilities.
export * from "./adapters/governance-events.adapter";
export * from "./ports/gateway-debit.port";
export * from "./ports/governance-budget-overview.port";
export * from "./ports/governance-eventing.port";
export * from "./ports/ingestion-source-activity.port";
export * from "./ports/admin-workspace-view-audit.port";
export * from "./ports/ai-tool-catalog.port";
export * from "./ports/cli-bootstrap.port";
export * from "./ports/cli-token-store.port";
export * from "./ports/anomaly-rule.port";
export * from "./ports/department.port";
export * from "./ports/anomaly-alert-http.port";
export * from "./ports/governance-diagnostics.port";
export * from "./ports/governance-encryption.port";
export * from "./ports/governance-http.port";
export * from "./ports/governance-object-storage.port";
export * from "./ports/governance-signal.port";
export * from "./ports/governance-setup-state.port";
export * from "./ports/governance-webhook.port";
export * from "./ports/ingestion-pull.port";
export * from "./ports/ingestion-pull-lifecycle.port";
export * from "./ports/ingestion-pull-worker.port";
export * from "./ports/ingestion-source.port";
export * from "./ports/ingestion-template.port";
export * from "./ports/ocsf-export.port";
export * from "./ports/ingestion-source-key.port";
export * from "./ports/personal-usage.port";
export * from "./ports/personal-virtual-key.port";
export * from "./ports/pulled-usage-ledger.port";
export * from "./ports/pulled-usage-rate.port";
export * from "./ports/quarantine-fill.port";
export * from "./ports/routing-policy.port";
export * from "./ports/session-policy.port";
export * from "./ports/spend-spike-anomaly.port";
export * from "./ports/governance-subscriber.port";
export {
  AUTOMATION_MATCH_RECORDS_METRIC_DESCRIPTION,
  AUTOMATION_MATCH_RECORDS_METRIC_NAME,
  OtelTraceAlertMetricsAdapter,
} from "./adapters/otel.trace-alert-metrics.adapter";

export { IngestionPullEventingAdapter } from "./adapters/ingestion-pull.adapter";
export { PostgresAnomalyRuleAdapter } from "./adapters/postgres.anomaly-rule.adapter";
export { PostgresDepartmentAdapter } from "./adapters/postgres.department.adapter";
export { PostgresSpendSpikeAnomalyAdapter } from "./adapters/postgres.spend-spike-anomaly.adapter";
export { PostgresIngestionSourceActivityAdapter } from "./adapters/postgres.ingestion-source-activity.adapter";
export { PostgresIngestionSourceAdapter } from "./adapters/postgres.ingestion-source.adapter";
export { PostgresIngestionPullLifecycleAdapter } from "./adapters/postgres.ingestion-pull-lifecycle.adapter";
export { PostgresIngestionPullSourceAdapter } from "./adapters/postgres.ingestion-pull-source.adapter";
export { PostgresIngestionPullRunProjectionAdapter } from "./adapters/postgres.ingestion-pull-run-projection.adapter";
export { PostgresIngestionTemplateAdapter } from "./adapters/postgres.ingestion-template.adapter";
export { PulledUsageEventingAdapter } from "./adapters/pulled-usage.adapter";

export {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "./processes/gateway-debit.process";
export { GovernanceEventDeliveryProcess } from "./processes/governance-event-delivery.process";
export { IngestionPullProcess } from "./processes/ingestion-pull.process";
export { PulledUsageLedgerProcess } from "./processes/pulled-usage-ledger.process";

export { BuiltInPullerRegistryService } from "./services/built-in-puller-registry.service";
export { PullerRegistryService } from "./services/puller-registry.service";
export { AnthropicAdminPuller } from "./adapters/anthropic-admin-puller.adapter";
export { ClaudeComplianceReferencePuller } from "./adapters/claude-compliance-puller.adapter";
export { CopilotStudioReferencePuller } from "./adapters/copilot-studio-puller.adapter";
export { CopilotStudioDataversePuller } from "./adapters/copilot-studio-dataverse-puller.adapter";
export { DatabricksGeniePuller } from "./adapters/databricks-genie-puller.adapter";
export { HttpPollingPullerAdapter } from "./adapters/http-poller.adapter";
export { OpenAiComplianceReferencePuller } from "./adapters/openai-compliance-puller.adapter";
export { OpenAiAdminPuller } from "./adapters/openai-admin-puller.adapter";
export { hasPollerCursor } from "./adapters/poller-cursor.adapter";
export { conversationRoutingProfileFor } from "./services/ingestion-pull-worker.service";
export { S3PollingPullerAdapter } from "./adapters/s3-puller.adapter";
export { AnomalyRuleService } from "./services/anomaly-rule.service";
export { DepartmentService } from "./services/department.service";
export { AnomalyAlertDispatcherService } from "./services/anomaly-alert-dispatcher.service";
export { GovernanceSignalService } from "./services/governance-signal.service";
export { IngestionCredentialsService } from "./services/ingestion-credentials.service";
export { IngestionSecretConfiguration } from "./services/ingestion-source-secret.service";
export { IngestionSecretService } from "./services/ingestion-source-secret.service";
export { IngestionPullLifecycleService } from "./services/ingestion-pull-lifecycle.service";
export { IngestionPullService } from "./services/ingestion-pull.service";
export { IngestionPullWorkerService } from "./services/ingestion-pull-worker.service";
export { PullDestinationService } from "./services/pull-destination.service";
export { PulledUsagePricingService } from "./services/pulled-usage-pricing.service";
export { PulledUsageRecordService } from "./services/pulled-usage-record.service";
export {
  OrganizationSessionPolicyService,
  SESSION_POLICY_MAX_DAYS,
  SessionPolicyOutOfRangeError,
} from "./services/organization-session-policy.service";
export { PostgresSessionPolicyAdapter } from "./adapters/postgres.session-policy.adapter";
export { GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS } from "./subscribers/governance-ocsf.subscriber";
export {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
} from "./subscribers/governance-kpis.subscriber";
export { GovernanceOcsfSubscriber } from "./subscribers/governance-ocsf.subscriber";
export { TraceAlertTriggerMatchSubscriber } from "./subscribers/trace-alert-trigger-match.subscriber";

/**
 * The app-process tRPC transports this feature owns. The process supplies its
 * root, authenticated procedure and policy chain; the procedure names, input
 * schemas, access declarations and delegation are the feature's.
 */
export {
  PersonalVirtualKeyTrpcApi,
  type PersonalVirtualKeyTrpcContext,
} from "./transport/api-trpc/personal-virtual-key.api";
export {
  RoutingPolicyTrpcApi,
  type RoutingPolicyTrpcContext,
} from "./transport/api-trpc/routing-policy.api";
export {
  PersonalDashboardTrpcApi,
  type PersonalDashboardTrpcContext,
} from "./transport/api-trpc/personal-dashboard.api";
export {
  PersonalSessionsTrpcApi,
  type PersonalSessionsTrpcContext,
} from "./transport/api-trpc/personal-sessions.api";
export {
  SessionPolicyTrpcApi,
  type SessionPolicyTrpcContext,
} from "./transport/api-trpc/session-policy.api";
export {
  IngestionKeyTrpcApi,
  type IngestionKeyTrpcContext,
} from "./transport/api-trpc/ingestion-key.api";
export {
  DepartmentsTrpcApi,
  type DepartmentsTrpcContext,
} from "./transport/api-trpc/departments.api";
export {
  IngestionTemplatesTrpcApi,
  type IngestionTemplatesTrpcContext,
} from "./transport/api-trpc/ingestion-templates.api";
export {
  ActivityMonitorTrpcApi,
  type ActivityMonitorTrpcContext,
} from "./transport/api-trpc/activity-monitor.api";
export {
  AnomalyRulesTrpcApi,
  type AnomalyRulesTrpcContext,
} from "./transport/api-trpc/anomaly-rules.api";
export { GovernanceTrpcApi, type GovernanceTrpcContext } from "./transport/api-trpc/governance.api";
export {
  IngestionSourcesTrpcApi,
  toIngestionSourceDto,
  type IngestionSourcesTrpcContext,
} from "./transport/api-trpc/ingestion-sources.api";
export { AiToolsTrpcApi, type AiToolsTrpcContext } from "./transport/api-trpc/ai-tools.api";

/**
 * The public REST family this feature owns. The process supplies the bound
 * REST security service and resolvers for the governance and project
 * services; the base path, access declarations, schemas and delegation are
 * the feature's.
 */
export { createGovernanceRestApp } from "./transport/api-rest/governance.api";

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
} from "./transport/api-rest/governance-cli.api";

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
} from "./transport/api-rest/governance-ingest.api";
export {
  extractIngestClientIp,
  GovernanceIngestRateLimitPort,
  INGEST_RATE_LIMIT_MAX_REQUESTS,
  INGEST_RATE_LIMIT_WINDOW_SECONDS,
} from "./ports/governance-ingest-rate-limit.port";
export {
  resolveOrgAdminEmail,
  resolveSupportContact,
} from "./services/organization-support-contact.service";

/**
 * The governance tools installed on a hosted MCP session.
 *
 * Exported from here, and not from the hosted MCP endpoint, because a core
 * feature package may not depend on an Enterprise one. The process that has
 * both registers these through the endpoint's session-tool seam.
 */
export {
  GovernanceMcpPermissionProbePort,
  registerGovernanceMcpTools,
  type GovernanceMcpContext,
} from "./transport/api-mcp/governance-tools.api";
