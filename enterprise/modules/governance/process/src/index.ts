// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type { DepartmentService } from "./features/identity/services/department.service.ts";

/**
 * The landing decision, re-exported beside the service it gathers signals from.
 */
export {
  PersonaHomeResolverService,
  type PersonaResolution,
} from "@langwatch/enterprise-governance-contract";

// Process and eventing boundaries. Domain collaborators remain private to the
// installation adapter and are never application capabilities.
export type * from "./repositories/ai-tool-catalog.repository.ts";
export type * from "./repositories/anomaly-rule.repository.ts";
export type * from "./repositories/department.repository.ts";
export type * from "./repositories/governance-setup-state.repository.ts";
export type * from "./repositories/ingestion-pull-lifecycle.repository.ts";
export type * from "./repositories/ingestion-source.repository.ts";
export type * from "./repositories/ingestion-template.repository.ts";
export type * from "./repositories/spend-spike-anomaly.repository.ts";

export {
  COST_ROLLUP_WATCH_PROCESS_NAME,
  CostRollupWatchProcess,
  type CostRollupWatchState,
} from "./eventing/cost-rollup-watch.process.ts";
export {
  COST_ROLLUP_WATCH_MAX_ATTEMPTS,
  CostRollupCheckUnsettledError,
} from "./eventing/cost-rollup-watch.intent.ts";
export { IngestionPullProcess } from "./eventing/ingestion-pull.process.ts";
export { PulledUsageLedgerProcess } from "./eventing/pulled-usage-ledger.process.ts";

export type { AgentsListingSummary } from "./features/agents/rules/agents-listing-outcome.rules.ts";
export type {
  AgentsListingOutcome,
  AgentsListingRefusalCause,
} from "@langwatch/enterprise-governance-contract";
export type { IngestionPullLifecycleService } from "./features/ingestion-pull/services/ingestion-pull-lifecycle.service.ts";

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
export { governanceProcessModule } from "./governance.module.ts";

// The CLI governance plane: fourteen routes under `/api/auth/cli` that
// authenticate with a device-session bearer and dispatch into governance. They
// sit under an auth path because the project-scoped governance REST rejects a
// device token; the services underneath are the console's own.
export { governanceCliRest } from "./transport/governance-cli.rest.ts";
export type {
  GovernanceCliAccessApi,
  GovernanceCliAccessMembers,
  GovernanceCliCaller,
} from "./features/cli/services/governance-cli-access.service.ts";
export type {
  GovernanceCliActivityApi,
  GovernanceCliActivityMembers,
} from "./features/cli/services/governance-cli-activity.service.ts";
export type {
  GovernanceCliCredentialApi,
  GovernanceCliCredentialMembers,
  GovernanceCliPersonalWorkspace,
} from "./features/cli/services/governance-cli-credentials.service.ts";

// The Activity Monitor's push-mode receivers.
export { governanceIngestRest } from "./transport/governance-ingest.rest.ts";
export type {
  GovernanceIngestAccessApi,
  GovernanceIngestAccessMembers,
  GovernanceIngestAuthorization,
} from "./features/ingest/services/governance-ingest-access.service.ts";
export type {
  GovernanceIngestLogCollectionChannel,
  GovernanceIngestMetricCollectionChannel,
  GovernanceIngestPrincipalDirectory,
  GovernanceIngestReceiverApi,
  GovernanceIngestReceiverMembers,
  GovernanceIngestSpend,
  GovernanceIngestTraceCollection,
} from "./features/ingest/services/governance-ingest-receiver.service.ts";

export type { GovernanceMcpServer } from "./services/governance-mcp-tools.service.ts";
