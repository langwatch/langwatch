import {
  bindRestHeader,
  bindRestMiddleware,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import { defineServerModule } from "@langwatch/kernel";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a process composes this feature's process-side work from: the ingestion
 * pull worker, the two ingestion pipelines and the lifecycle half behind them.
 * A composition names the ports it can answer and the connections it holds, and
 * gets the collaborator back. Every puller, registry, repository and service
 * stays private to this feature server — a composition states which substrates
 * it has, never which class to construct.
 */
import type { ProjectApi } from "@langwatch/project-contract";

import {
  GovernanceInstallationComposition,
  type GovernanceInstallationOptions,
} from "./app/governance-installation-composition.build.ts";
import {
  PostgresGovernanceAdapter,
  type PostgresGovernanceAdapterOptions,
  type PostgresGovernanceServices,
} from "./app/governance-policy-composition.build.ts";
import { GovernanceApp } from "./app/governance.app.ts";
import type {
  GovernanceDiagnosticsSink,
  GovernanceSignalChannel,
  IngestionPullLifecycleChannel,
  IngestionPullMetricsSink,
  IngestionPullOutcomeChannel,
  IngestionPullRunner,
  IngestionPullSourceReader,
  IngestionPullTenantResolver,
  AnomalyAlertHttpClient,
  AnomalySpendReader,
} from "./app/governance.members.ts";
import type { CostRollupWatchProcess } from "./eventing/cost-rollup-watch.process.ts";
import { governanceEventsEventing } from "./eventing/governance-events.pipeline.ts";
import { ingestionPullReconcileEventing } from "./eventing/ingestion-pull-reconcile.pipeline.ts";
import { ingestionPullEventing } from "./eventing/ingestion-pull.pipeline.ts";
import type { IngestionPullProcess } from "./eventing/ingestion-pull.process.ts";
import type { PulledUsageLedgerProcess } from "./eventing/pulled-usage-ledger.process.ts";
import { pulledUsageEventing } from "./eventing/pulled-usage.pipeline.ts";
import { governanceRepositories } from "./repositories/governance-repositories.registry.ts";
import type { IngestionPullLifecycleDatabase } from "./repositories/ingestion-pull-lifecycle.repository.ts";
import {
  PrismaDepartmentRepository,
  type DepartmentDatabase,
} from "./repositories/prisma/prisma.department.repository.ts";
import { PrismaIngestionPullLifecycleRepository } from "./repositories/prisma/prisma.ingestion-pull-lifecycle.repository.ts";
import {
  PrismaIngestionPullRunProjectionRepository,
  type IngestionPullRunProjectionDatabase,
} from "./repositories/prisma/prisma.ingestion-pull-run-projection.repository.ts";
import {
  PrismaIngestionSourceRepository,
  type IngestionSourceDatabase,
} from "./repositories/prisma/prisma.ingestion-source.repository.ts";
import {
  PrismaSpendSpikeAnomalyRepository,
  type SpendSpikeAnomalyDatabase,
} from "./repositories/prisma/prisma.spend-spike-anomaly.repository.ts";
import type { AgentsListingSummary } from "./rules/agents-listing-outcome.rules.ts";
import { AnomalyAlertDispatcherService } from "./services/anomaly-alert-dispatcher.service.ts";
import {
  type DepartmentOrganizations,
  type DepartmentProjects,
  DepartmentService,
} from "./services/department.service.ts";
import {
  GovernanceEventsAdapter,
  type GovernanceEventsPipelineDeps,
} from "./services/governance-events.service.ts";
import { GovernanceSignalService } from "./services/governance-signal.service.ts";
import { IngestionPullEventingAdapter } from "./services/ingestion-pull-eventing.service.ts";
import { IngestionPullLifecycleService } from "./services/ingestion-pull-lifecycle.service.ts";
import { IngestionPullService } from "./services/ingestion-pull.service.ts";
import { PulledUsageEventingAdapter } from "./services/pulled-usage-eventing.service.ts";
import { SpendSpikeAnomalyEvaluatorService } from "./services/spend-spike-anomaly-evaluator.service.ts";
import { activityMonitorTrpcTransport } from "./transport/activity-monitor.trpc.ts";
import { anomalyRulesTrpcTransport } from "./transport/anomaly-rules.trpc.ts";
import { departmentsTrpcTransport } from "./transport/departments.trpc.ts";
import { governanceAgentsTrpcTransport } from "./transport/governance-agents.trpc.ts";
import { governancePeopleTrpcTransport } from "./transport/governance-people.trpc.ts";
import {
  governanceRest,
  governanceRestCaller,
  governanceRestSurface,
} from "./transport/governance.rest.ts";
import { governanceTrpcTransport } from "./transport/governance.trpc.ts";
import { ingestionKeyTrpcTransport } from "./transport/ingestion-key.trpc.ts";
import { ingestionSourcesTrpcTransport } from "./transport/ingestion-sources.trpc.ts";
import { ingestionTemplatesTrpcTransport } from "./transport/ingestion-templates.trpc.ts";
import { personalSessionsTrpcTransport } from "./transport/personal-sessions.trpc.ts";
import { personalVirtualKeysTrpcTransport } from "./transport/personal-virtual-keys.trpc.ts";
import { routingPolicyTrpcTransport } from "./transport/routing-policy.trpc.ts";
import { sessionPolicyTrpcTransport } from "./transport/session-policy.trpc.ts";

/**
 * The whole module, declared: one application and the REST family it answers.
 * A process installs this and mounts what it wants; the repositories and
 * services behind the application stay private to this feature server.
 *
 * `governanceCliRest` and `governanceIngestRest` are not mounted here: both
 * bind tokens their own transport files declare
 * (`transport/governance-cli.rest.ts`, `transport/governance-ingest.rest.ts`)
 * that no process resolves, because nothing builds the
 * `createGovernanceInstallation` facade behind them yet. Dropping them from
 * the boot graph is wire-neutral — neither surfaces in the platform's route
 * list today.
 */
export const governanceServer = defineServerModule("governance")
  .withRepositories(governanceRepositories)
  .withApp(GovernanceApp)
  .withTransports(
    governanceRest,
    departmentsTrpcTransport,
    ingestionTemplatesTrpcTransport,
    ingestionSourcesTrpcTransport,
    governanceTrpcTransport,
    anomalyRulesTrpcTransport,
    activityMonitorTrpcTransport,
    personalSessionsTrpcTransport,
    ingestionKeyTrpcTransport,
    personalVirtualKeysTrpcTransport,
    routingPolicyTrpcTransport,
    sessionPolicyTrpcTransport,
    governancePeopleTrpcTransport,
    governanceAgentsTrpcTransport,
  )
  // The member behind the project credential, and which surface asked. A
  // legacy project key names no member, which is what the admin routes refuse.
  .withTransportFacts(() => [
    bindRestMiddleware(governanceRestCaller, (context) => {
      const credential = projectCredentialOfRequest(context.req.raw);

      return { viewerUserId: credential.type === "apiKey" ? credential.userId : null };
    }),
    bindRestHeader(governanceRestSurface, "X-LangWatch-Surface"),
  ])
  .withEventing(governanceEventsEventing)
  .withEventing(pulledUsageEventing)
  .withEventing(ingestionPullEventing)
  .withEventing(ingestionPullReconcileEventing);

/**
 * The ingestion-pull pipeline: its run-status projection over the process's own
 * connection, and the process manager that drives one run. The projection
 * repository behind it stays private to this feature server.
 */
export function createIngestionPullEventing(options: {
  runStatusDatabase: IngestionPullRunProjectionDatabase;
  process: IngestionPullProcess;
}): ReturnType<typeof IngestionPullEventingAdapter.prototype.build> {
  return IngestionPullEventingAdapter.create({
    runStatusStore: PrismaIngestionPullRunProjectionRepository.create(options.runStatusDatabase),
    process: options.process,
  }).build();
}

/**
 * The pulled-usage pipeline, with whichever of the two process managers this
 * deployment composes: the ledger, and the cost-summary watch.
 */
export function createPulledUsageEventing(
  options: {
    ledger?: PulledUsageLedgerProcess;
    /** Absent in a deployment with no cost summary to check. */
    costRollupWatch?: CostRollupWatchProcess;
  } = {},
): ReturnType<typeof PulledUsageEventingAdapter.prototype.build> {
  return PulledUsageEventingAdapter.create(options).build();
}

/** One pull attempt's execution: what runs it, where its outcome lands, what it reports. */
export function createIngestionPullExecution(options: {
  run: IngestionPullRunner;
  outcome: IngestionPullOutcomeChannel;
  metrics: IngestionPullMetricsSink;
}): IngestionPullService {
  return IngestionPullService.create({
    runPort: options.run,
    outcomePort: options.outcome,
    metrics: options.metrics,
  });
}

/**
 * The lifecycle half: which sources are scheduled, reconciled against what the
 * process last recorded. The lifecycle repository stays private to this feature
 * server — a composition names its connection, not the repository.
 */
export function createIngestionPullLifecycle(options: {
  database: IngestionPullLifecycleDatabase;
  projects: Pick<ProjectApi, "findInternalIds">;
  tenant: IngestionPullTenantResolver;
  commands: IngestionPullLifecycleChannel;
  diagnostics?: GovernanceDiagnosticsSink;
}): IngestionPullLifecycleService {
  return IngestionPullLifecycleService.create({
    repository: PrismaIngestionPullLifecycleRepository.create(options.database),
    projects: options.projects,
    tenant: options.tenant,
    commands: options.commands,
    diagnostics: options.diagnostics,
  });
}

/** The latest agents listing each named source reported, within one project. */
export function findAgentsListings(options: {
  database: IngestionPullRunProjectionDatabase;
  sourceIds: readonly string[];
  projectId: string;
}): Promise<Map<string, AgentsListingSummary>> {
  return PrismaIngestionPullRunProjectionRepository.create(options.database).findAgentsListings({
    sourceIds: options.sourceIds,
    projectId: options.projectId,
  });
}

/**
 * The whole Governance capability an API-role process installs, over the
 * connection and the peers it holds. Every repository and service behind it
 * stays private to this feature server.
 */
export function createGovernanceInstallation(
  options: GovernanceInstallationOptions,
): GovernanceApi {
  return GovernanceInstallationComposition.create(options).build();
}

/** Where a governance signal is stated, and where a failure to state it is reported. */
export function createGovernanceSignals(
  channel: GovernanceSignalChannel,
  diagnostics?: GovernanceDiagnosticsSink,
): GovernanceSignalService {
  return GovernanceSignalService.create(channel, diagnostics);
}

/** The department directory, over the process's own connection. */
export function createDepartmentDirectory(
  database: DepartmentDatabase,
  organizations: DepartmentOrganizations,
  projects: DepartmentProjects,
): DepartmentService {
  return DepartmentService.create({
    repository: PrismaDepartmentRepository.create(database),
    organizations,
    projects,
  });
}

/**
 * The spend-spike evaluator one scheduler tick runs: the rules it reads, the
 * windows it compares, and where a fire decision is dispatched.
 */
export function createSpendSpikeAnomalyEvaluator(options: {
  database: SpendSpikeAnomalyDatabase;
  spend: AnomalySpendReader;
  http: AnomalyAlertHttpClient;
}): SpendSpikeAnomalyEvaluatorService {
  return SpendSpikeAnomalyEvaluatorService.create({
    repository: PrismaSpendSpikeAnomalyRepository.create(options.database),
    spend: options.spend,
    dispatcher: AnomalyAlertDispatcherService.create({ http: options.http }),
  });
}

/**
 * The Governance services a worker-role process reads, over its own connection.
 * The repository behind them stays private to this feature server.
 */
export function createGovernanceServices(
  options: PostgresGovernanceAdapterOptions,
): PostgresGovernanceServices {
  return PostgresGovernanceAdapter.create(options).build();
}

/** The Governance events pipeline a process registers on its event sourcing. */
export function createGovernanceEventsPipeline(
  deps: GovernanceEventsPipelineDeps,
): ReturnType<typeof GovernanceEventsAdapter.prototype.pipeline> {
  return GovernanceEventsAdapter.create(deps).pipeline();
}

/** The sources one ingestion-pull installation reads, over its own connection. */
export function createIngestionPullSources(
  database: IngestionSourceDatabase,
): IngestionPullSourceReader {
  return PrismaIngestionSourceRepository.create(database);
}
