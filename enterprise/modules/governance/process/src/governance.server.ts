// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a process composes this feature's process-side work from: the ingestion
 * pull worker, the two ingestion pipelines and the lifecycle half behind them.
 * A composition names the ports it can answer and the connections it holds, and
 * gets the collaborator back. Every puller, registry, repository and service
 * stays private to this feature server — a composition states which substrates
 * it has, never which class to construct.
 */
import {
  bindRestHeader,
  bindRestMiddleware,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import { defineServerModule } from "@langwatch/kernel";

import {
  GovernanceInstallationComposition,
  type GovernanceInstallationOptions,
} from "./app/governance-installation-composition.build.ts";
import {
  createGovernanceMemberInfrastructure,
  type GovernanceMemberDatabase,
} from "./app/governance-member-infrastructure.ts";
import {
  PostgresGovernanceAdapter,
  type PostgresGovernanceAdapterOptions,
  type PostgresGovernanceServices,
} from "./app/governance-policy-composition.build.ts";
import { GovernanceApp } from "./app/governance.app.ts";
import type {
  GovernanceDiagnosticsSink,
  GovernanceEncryptor,
  GovernanceHttpClient,
  GovernanceObjectStore,
  GovernanceOcsfEventSink,
  GovernanceProjectDirectory,
  GovernanceSignalChannel,
  TraceAlertMetricsSink,
  IngestionPullDiagnosticsSink,
  IngestionPullLifecycleChannel,
  IngestionPullMetricsSink,
  IngestionPullOutcomeChannel,
  IngestionPullRunner,
  IngestionPullSourceReader,
  IngestionPullTenantResolver,
  PulledUsageEntitlements,
  PulledUsageRateReader,
  AnomalyAlertHttpClient,
  AnomalySpendReader,
} from "./app/governance.members.ts";
import { ClaudeComplianceReferencePullerAdapter } from "./channels/http/http.claude-compliance.channel.ts";
import { HttpCopilotStudioDataverseChannel } from "./channels/http/http.copilot-studio-dataverse.channel.ts";
import { HttpCopilotStudioChannel } from "./channels/http/http.copilot-studio.channel.ts";
import { HttpPollingPullerAdapter } from "./channels/http/http.polling.channel.ts";
import type { CostRollupWatchProcess } from "./eventing/cost-rollup-watch.process.ts";
import { governanceEventsEventing } from "./eventing/governance-events.pipeline.ts";
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
import { AnthropicAdminPullerAdapter } from "./services/anthropic-admin-puller.service.ts";
import { BuiltInPullerRegistryService } from "./services/built-in-puller-registry.service.ts";
import { DatabricksGeniePullerService } from "./services/databricks-genie-puller.service.ts";
import { DepartmentService } from "./services/department.service.ts";
import {
  GovernanceEventsAdapter,
  type GovernanceEventsPipelineDeps,
} from "./services/governance-events.service.ts";
import { GovernanceSignalService } from "./services/governance-signal.service.ts";
import { IngestionCredentialsService } from "./services/ingestion-credentials.service.ts";
import { IngestionPullEventingAdapter } from "./services/ingestion-pull-eventing.service.ts";
import { IngestionPullLifecycleService } from "./services/ingestion-pull-lifecycle.service.ts";
import { IngestionPullWorkerService } from "./services/ingestion-pull-worker.service.ts";
import { IngestionPullService } from "./services/ingestion-pull.service.ts";
import { OpenAiAdminPullerAdapter } from "./services/openai-admin-puller.service.ts";
import { OpenAiComplianceReferencePullerService } from "./services/openai-compliance-puller.service.ts";
import { OtelTraceAlertMetricsAdapter } from "./services/otel-trace-alert-metrics.service.ts";
import { PulledUsageEventingAdapter } from "./services/pulled-usage-eventing.service.ts";
import { PulledUsagePricingService } from "./services/pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "./services/pulled-usage-record.service.ts";
import { PullerRegistryService } from "./services/puller-registry.service.ts";
import { S3PollingPullerService } from "./services/s3-puller.service.ts";
import { SpendSpikeAnomalyEvaluatorService } from "./services/spend-spike-anomaly-evaluator.service.ts";
import {
  governanceRest,
  governanceRestCaller,
  governanceRestSurface,
} from "./transport/governance.rest.ts";

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
  .withTransports(governanceRest)
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
  .withEventing(ingestionPullEventing);

/** The substrates one ingestion-pull worker installation is built over. */
export type IngestionPullWorkerSubstrates = Readonly<{
  /** The sources this installation pulls. */
  sources: IngestionPullSourceReader;
  /** Where a pulled tenant's internal governance project is resolved. */
  projects: GovernanceProjectDirectory;
  /** The egress-guarded HTTP client every polling puller reaches through. */
  http: GovernanceHttpClient;
  /** The object store the file-drop pullers list and read. */
  objects: GovernanceObjectStore;
  /** Where a normalized pull event is written as an OCSF fact. */
  sink: GovernanceOcsfEventSink;
  /** How a stored source credential is sealed and opened. */
  encryptor: GovernanceEncryptor;
  /** Whether this organization's pulled usage carries a cost. */
  usageEntitlement: PulledUsageEntitlements;
  /** The rate one pulled usage record is priced at. */
  usageRate: PulledUsageRateReader;
  /** Where a run's progress and its failures are reported. */
  diagnostics: IngestionPullDiagnosticsSink;
}>;

/** Every built-in puller, registered on one registry in a fixed order. */
function builtInPullers(
  substrates: Pick<IngestionPullWorkerSubstrates, "http" | "objects" | "diagnostics">,
): PullerRegistryService {
  const { http, objects, diagnostics } = substrates;
  const pullers = PullerRegistryService.create();

  pullers.register(HttpPollingPullerAdapter.create({ http, diagnostics }));
  pullers.register(S3PollingPullerService.create({ objects, diagnostics }));
  pullers.register(HttpCopilotStudioChannel.create({ http }));
  pullers.register(HttpCopilotStudioDataverseChannel.create(http));
  pullers.register(OpenAiComplianceReferencePullerService.create({ objects, diagnostics }));
  pullers.register(OpenAiAdminPullerAdapter.create(http));
  pullers.register(ClaudeComplianceReferencePullerAdapter.create({ http, diagnostics }));
  pullers.register(AnthropicAdminPullerAdapter.create(http));
  pullers.register(DatabricksGeniePullerService.create(http));

  return BuiltInPullerRegistryService.create(pullers).build();
}

/** One ingestion-pull worker, over the substrates the process owns. */
export function createIngestionPullWorker(
  substrates: IngestionPullWorkerSubstrates,
): IngestionPullWorkerService {
  return IngestionPullWorkerService.create({
    sources: substrates.sources,
    registry: builtInPullers(substrates),
    credentials: IngestionCredentialsService.create(substrates.encryptor),
    projects: substrates.projects,
    sink: substrates.sink,
    usageEntitlement: substrates.usageEntitlement,
    usageRecords: PulledUsageRecordService.create(
      PulledUsagePricingService.create(substrates.usageRate),
    ),
    diagnostics: substrates.diagnostics,
  });
}

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
  tenant: IngestionPullTenantResolver;
  commands: IngestionPullLifecycleChannel;
  diagnostics?: GovernanceDiagnosticsSink;
}): IngestionPullLifecycleService {
  return IngestionPullLifecycleService.create({
    repository: PrismaIngestionPullLifecycleRepository.create(options.database),
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
export function createDepartmentDirectory(database: DepartmentDatabase): DepartmentService {
  return DepartmentService.create({ repository: PrismaDepartmentRepository.create(database) });
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

export { createGovernanceMemberInfrastructure, type GovernanceMemberDatabase };

/** The Governance events pipeline a process registers on its event sourcing. */
export function createGovernanceEventsPipeline(
  deps: GovernanceEventsPipelineDeps,
): ReturnType<typeof GovernanceEventsAdapter.prototype.pipeline> {
  return GovernanceEventsAdapter.create(deps).pipeline();
}

/** Where a trace-alert match is counted. */
export function createTraceAlertMetrics(): TraceAlertMetricsSink {
  return OtelTraceAlertMetricsAdapter.create();
}

/** The sources one ingestion-pull installation reads, over its own connection. */
export function createIngestionPullSources(
  database: IngestionSourceDatabase,
): IngestionPullSourceReader {
  return PrismaIngestionSourceRepository.create(database);
}
