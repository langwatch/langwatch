// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export {
  PostgresGovernanceAdapter,
  type PostgresGovernanceServices,
} from "./app/governance-policy-composition.build.ts";
export type { DepartmentService } from "./services/department.service.ts";
export type { GovernanceSignalService } from "./services/governance-signal.service.ts";
export type { SpendSpikeAnomalyEvaluatorService } from "./services/spend-spike-anomaly-evaluator.service.ts";

export type {
  GovernanceDirectoryProject,
  GovernanceMembershipStatus,
} from "./repositories/governance-directory.repository.ts";
export type { PersonalUsageRollup } from "./services/personal-usage-dashboard.service.ts";
/**
 * The landing decision, re-exported beside the service it gathers signals from.
 */
export {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";
export type { GovernanceInstallationOptions } from "./app/governance-installation-composition.build.ts";

/**
 * The feature's application: the one typed thing its transports are given.
 * Every door reaches the same object, so a rule written on it is the rule
 * every door gets.
 */
export type {
  GovernanceActorDirectory,
  GovernanceActorUser,
  GovernanceAppDependencies,
  GovernanceBespokeMembers,
  GovernancePersonalVirtualKeyMembers,
} from "./app/governance.app.ts";

// Process and eventing boundaries. Domain collaborators remain private to the
// installation adapter and are never application capabilities.
export { GovernanceEventsAdapter } from "./services/governance-events.service.ts";
export type * from "./app/governance.members.ts";
export type * from "./repositories/admin-workspace-view-audit.repository.ts";
export type * from "./repositories/ai-tool-catalog.repository.ts";
export type * from "./repositories/anomaly-rule.repository.ts";
export type * from "./repositories/department.repository.ts";
export type * from "./repositories/governance-setup-state.repository.ts";
export type * from "./repositories/ingestion-pull-lifecycle.repository.ts";
export type * from "./repositories/ingestion-source.repository.ts";
export type * from "./repositories/ingestion-template.repository.ts";
export type * from "./repositories/personal-virtual-key.repository.ts";
export type * from "./repositories/routing-policy.repository.ts";
export type * from "./repositories/session-policy.repository.ts";
export type * from "./repositories/spend-spike-anomaly.repository.ts";

export { SEAT_REPORT_ACTION } from "./rules/microsoft-graph-seats.rules.ts";
export type { SpendSpikeAnomalyDatabase } from "./repositories/prisma/prisma.spend-spike-anomaly.repository.ts";
export type { IngestionSourceDatabase } from "./repositories/prisma/prisma.ingestion-source.repository.ts";
export type { IngestionPullRunProjectionDatabase } from "./repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";

export {
  GATEWAY_DEBITS_PROCESS_NAME,
  GatewayDebitProcess,
} from "./eventing/gateway-debit.process.ts";
export {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  CostRollupWatchProcess,
  type CostRollupWatchState,
} from "./eventing/cost-rollup-watch.process.ts";
export {
  COST_ROLLUP_WATCH_MAX_ATTEMPTS,
  CostRollupCheckUnsettledError,
} from "./eventing/cost-rollup-watch.intent.ts";
export { GovernanceEventDeliveryProcess } from "./eventing/governance-event-delivery.process.ts";
export { IngestionPullProcess } from "./eventing/ingestion-pull.process.ts";
export { PulledUsageLedgerProcess } from "./eventing/pulled-usage-ledger.process.ts";

/**
 * The ingestion pull worker, composed over the ports a process can answer. The
 * pullers, the registry and the credential, pricing and usage-record services
 * behind it stay private to this feature server.
 */
export {
  createDepartmentDirectory,
  createGovernanceEventsPipeline,
  createGovernanceInstallation,
  createGovernanceMemberInfrastructure,
  createGovernanceSignals,
  createIngestionPullEventing,
  createIngestionPullExecution,
  createIngestionPullLifecycle,
  createGovernanceServices,
  createIngestionPullSources,
  createPulledUsageEventing,
  createSpendSpikeAnomalyEvaluator,
  findAgentsListings,
} from "./governance.server.ts";
export type { AgentsListingSummary } from "./rules/agents-listing-outcome.rules.ts";
export { deriveAgentsListingOutcome } from "./rules/agents-listing-outcome.rules.ts";
export type {
  AgentsListingOutcome,
  AgentsListingRefusalCause,
} from "@langwatch/enterprise-governance-contract";
export type { IngestionPullLifecycleService } from "./services/ingestion-pull-lifecycle.service.ts";
export type { IngestionPullWorkerService } from "./services/ingestion-pull-worker.service.ts";
export { GOVERNANCE_OCSF_EVENTS_SYNC_WINDOW_MS } from "./eventing/governance-ocsf.subscriber.ts";
export {
  GOVERNANCE_KPIS_SYNC_WINDOW_MS,
  GovernanceKpisSubscriber,
} from "./eventing/governance-kpis.subscriber.ts";
export { GovernanceOcsfSubscriber } from "./eventing/governance-ocsf.subscriber.ts";

// The thirteen tRPC transports this feature owns are not exported: they still
// name the deleted legacy builder, so nothing may reach them until each is
// converted to the declared `defineTrpcRouter` shape.

/**
 * The public REST family this feature owns, as a declaration: its paths,
 * permissions, schemas and handlers. The installer names it; a process mounts
 * that installer rather than reaching for the declaration itself.
 */
export {
  governanceRest,
  governanceRestCaller,
  governanceRestSurface,
} from "./transport/governance.rest.ts";
export { GovernanceApp } from "./app/governance.app.ts";
export { governanceServer } from "./governance.server.ts";

// The CLI governance plane: fourteen routes under `/api/auth/cli` that
// authenticate with a device-session bearer and dispatch into governance. They
// sit under an auth path because the project-scoped governance REST rejects a
// device token; the services underneath are the console's own.
export { governanceCliRest } from "./transport/governance-cli.rest.ts";
export type {
  GovernanceCliAccessApi,
  GovernanceCliAccessMembers,
  GovernanceCliAccessToken,
  GovernanceCliCaller,
  GovernanceCliMemberDirectory,
} from "./services/governance-cli-access.service.ts";
export type {
  GovernanceCliActivityApi,
  GovernanceCliActivityMembers,
} from "./services/governance-cli-activity.service.ts";
export type {
  GovernanceCliBudgetReader,
  GovernanceCliCredentialApi,
  GovernanceCliCredentialMembers,
  GovernanceCliPersonalWorkspace,
  GovernanceCliPersonDirectory,
} from "./services/governance-cli-credentials.service.ts";

// The Activity Monitor's push-mode receivers. A signal whose collection this
// process did not compose answers `not-served`, so an exporter gets a
// permanent 404 rather than a 500 from a receiver that pretends to serve it.
export { governanceIngestRest } from "./transport/governance-ingest.rest.ts";
export type {
  GovernanceIngestAccessApi,
  GovernanceIngestAccessMembers,
  GovernanceIngestAuthorization,
} from "./services/governance-ingest-access.service.ts";
export type {
  GovernanceIngestLogCollectionChannel,
  GovernanceIngestMetricCollectionChannel,
  GovernanceIngestPrincipalDirectory,
  GovernanceIngestReceiverApi,
  GovernanceIngestReceiverMembers,
  GovernanceIngestSpend,
  GovernanceIngestTraceCollection,
} from "./services/governance-ingest-receiver.service.ts";

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
