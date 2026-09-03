import {
  AppGovernanceEventingAdapter,
  AppGovernanceEventingRuntime,
  AppIngestionPullExecutionRuntime,
  AppIngestionPullLifecycleRuntime,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { AppIngestionPullWorkerAdapter } from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import {
  GovernanceIngestionAwsPort,
  GovernanceIngestionEgressPort,
  OtelGovernanceIngestionPullMetrics,
  UtcGovernanceIngestionPullSchedule,
  WorkerGovernanceIngestionPullHost,
} from "@langwatch/enterprise-worker";
import {
  PostgresIngestionPullSourceAdapter,
  type IngestionPullLifecycleDatabase,
} from "@langwatch/enterprise-governance-server";
import { GatewayBudgetLedgerAdapter } from "@langwatch/gateway-server";
import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { Logger } from "@langwatch/observability";
import type { GovernanceInternalProjectPort } from "@langwatch/project-server";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { GovernanceIngestionWorkerCapability } from "../features/governance/governance-ingestion-worker-feature.installer";
import type { WorkerConfig } from "../platform/config/worker.config";

export type WorkerGovernanceIngestionOptions = Readonly<{
  config: WorkerConfig;
  /** The one Prisma client this process opened, narrowed to what pull reads. */
  database: IngestionPullLifecycleDatabase;
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The two project reads a pull makes; see GovernanceInternalProjectPort. */
  projects: GovernanceInternalProjectPort;
  featureFlags: Pick<FeatureFlagService, "isEnabled">;
  /** The AWS client runtime this process already built for stored objects. */
  aws: AwsClientProcessRuntime;
  /** The cipher a source's stored credentials were written with. */
  encryption: { encrypt(value: string): string; decrypt(value: string): string };
  logger?: Logger;
}>;

/**
 * Enterprise Governance's two ingestion pipelines, composed from this
 * process's own substrates.
 *
 *     pulled_usage_processing     command:recordPulledUsage
 *                                 subscriber:pm:pulledUsageLedger
 *     ingestion_pull_processing   command:configure / disable
 *                                 command:recordRunCompleted / recordRunFailed
 *                                 stateProjection:ingestionPullRunStatus
 *                                 subscriber:pm:ingestionPull
 *
 * THE LEDGER IS SUPPLIED, NOT OPTIONAL, and that is a routing fact rather than
 * a preference: `subscriber:pm:pulledUsageLedger` is in the byte-frozen
 * registry, and the Enterprise adapter attaches that process manager only when
 * a ledger is present. A graph composed without one would claim
 * `event-sourcing/jobs` while leaving that key unrouted, so every pulled-usage
 * ledger job would redeliver forever with the pods up.
 *
 * `runsWorkers` is `true` rather than derived. In the application the same
 * value is `roleRunsWorkers(processRole)`, which asks whether THIS process
 * runs background work — and this process is the background worker. It decides
 * one thing: whether the schedule reconcile pass fires at boot.
 */
export function createWorkerGovernanceIngestion(
  options: WorkerGovernanceIngestionOptions,
): GovernanceIngestionWorkerCapability {
  const host = WorkerGovernanceIngestionPullHost.create({
    egress: new WorkerGovernanceIngestionEgress(),
    aws: new WorkerGovernanceIngestionAws(options.aws),
    encryption: options.encryption,
    featureFlags: options.featureFlags,
    ...(options.logger ? { logger: options.logger } : {}),
  });

  const runtime = AppGovernanceEventingRuntime.create(
    AppIngestionPullExecutionRuntime.create(
      AppIngestionPullWorkerAdapter.create({
        sources: PostgresIngestionPullSourceAdapter.create(options.database),
        host,
        projects: options.projects,
        events: new AppGovernanceOcsfEventsAdapter(
          options.resolveClickHouseClient as unknown as ConstructorParameters<
            typeof AppGovernanceOcsfEventsAdapter
          >[0],
        ),
      }).build(),
      GatewayBudgetLedgerAdapter.create(
        options.resolveClickHouseClient as unknown as Parameters<
          typeof GatewayBudgetLedgerAdapter.create
        >[0],
      ),
      OtelGovernanceIngestionPullMetrics.create(),
    ),
    AppIngestionPullLifecycleRuntime.create(
      options.database,
      options.projects,
      UtcGovernanceIngestionPullSchedule.create(),
      true,
    ),
  );

  return {
    register: (eventSourcing) =>
      AppGovernanceEventingAdapter.create(
        eventSourcing as unknown as Parameters<typeof AppGovernanceEventingAdapter.create>[0],
        runtime,
      ).register(),
  };
}

/**
 * A pull walks a URL the CUSTOMER typed, on a schedule, from inside the
 * cluster, with their own credentials attached — so it goes through the same
 * fence every other outbound request in this process does.
 *
 * `blockLocal` is the strict policy rather than the deployment's webhook
 * setting: a webhook destination is a place a customer chose to receive their
 * own data, and an ingestion source is a place we go and read from. The
 * relaxation that makes local webhook endpoints testable has no counterpart
 * here.
 */
class WorkerGovernanceIngestionEgress extends GovernanceIngestionEgressPort {
  private readonly validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

  async fetch(
    url: string,
    init: Parameters<GovernanceIngestionEgressPort["fetch"]>[1],
  ): Promise<Awaited<ReturnType<GovernanceIngestionEgressPort["fetch"]>>> {
    const validated = await this.validate(url);
    return fetchValidatedDestination(validated, init as never, {
      rejectUnauthorized: true,
    }) as unknown as Awaited<ReturnType<GovernanceIngestionEgressPort["fetch"]>>;
  }
}

/** The AWS client factory this process already built, behind the pull's port. */
class WorkerGovernanceIngestionAws extends GovernanceIngestionAwsPort {
  constructor(private readonly aws: AwsClientProcessRuntime) {
    super();
  }

  build(input: Parameters<GovernanceIngestionAwsPort["build"]>[0]) {
    return this.aws.build(input) as ReturnType<GovernanceIngestionAwsPort["build"]>;
  }
}
