import {
  AppGovernanceEventingAdapter,
  AppGovernanceEventingRuntime,
  AppIngestionPullExecutionRuntime,
  AppIngestionPullLifecycleRuntime,
} from "@langwatch/enterprise-api/governance/governance-eventing.adapter";
import { AppIngestionPullWorkerAdapter } from "@langwatch/enterprise-api/governance/ingestion-pull-worker.adapter";
import { AppGovernanceOcsfEventsAdapter } from "@langwatch/enterprise-api/governance/governance-ocsf-events.adapter";
import {
  GovernanceIngestionAws,
  GovernanceIngestionEgress,
  OtelGovernanceIngestionPullMetrics,
  UtcGovernanceIngestionPullSchedule,
  WorkerGovernanceIngestionPullHost,
} from "@langwatch/enterprise-worker";
import {
  PostgresIngestionPullSourceAdapter,
  type IngestionPullLifecycleDatabase,
  type IngestionPullRunProjectionDatabase,
  type IngestionSourceDatabase,
} from "@langwatch/enterprise-governance-server";
import { GatewayBudgetClickHouseRepository } from "@langwatch/gateway-server";
import { createSsrfUrlValidator, fetchValidatedDestination } from "@langwatch/egress";
import type { EventingClickHouseClientResolver } from "@langwatch/eventing/server";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { Logger } from "@langwatch/observability";
import type { GovernanceInternalProject } from "@langwatch/project-server";
import type { AwsClientProcessRuntime } from "@langwatch/aws-client";
import type { GovernanceIngestionWorkerCapability } from "../features/governance/governance-ingestion-worker-feature.installer.ts";
import type { WorkerConfig } from "../platform/config/worker.config.ts";

export type WorkerGovernanceIngestionOptions = Readonly<{
  config: WorkerConfig;
  /** The one Prisma client this process opened, narrowed to what pull reads. */
  database: IngestionPullLifecycleDatabase &
    IngestionSourceDatabase &
    IngestionPullRunProjectionDatabase;
  /** The deployment's tenant-keyed ClickHouse client. */
  resolveClickHouseClient: EventingClickHouseClientResolver;
  /** The two project reads a pull makes; see GovernanceInternalProject. */
  projects: GovernanceInternalProject;
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  /** The AWS client runtime this process already built for stored objects. */
  aws: AwsClientProcessRuntime;
  /** The cipher a source's stored credentials were written with. */
  encryption: { encrypt(value: string): string; decrypt(value: string): string };
  logger?: Logger;
}>;

// Two ingestion pipelines: pulled_usage_processing and ingestion_pull_processing;
// both use event-sourced commands and state projections
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
      GatewayBudgetClickHouseRepository.create(
        options.resolveClickHouseClient as unknown as Parameters<
          typeof GatewayBudgetClickHouseRepository.create
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

// Ingestion pull validates URLs through strict SSRF policy (blockLocal: true),
// not the webhook's testable-local relaxation
class WorkerGovernanceIngestionEgress extends GovernanceIngestionEgress {
  private readonly validate = createSsrfUrlValidator({ blockLocal: true, allowedHosts: [] });

  async fetch(
    url: string,
    init: Parameters<GovernanceIngestionEgress["fetch"]>[1],
  ): Promise<Awaited<ReturnType<GovernanceIngestionEgress["fetch"]>>> {
    const validated = await this.validate(url);
    return fetchValidatedDestination(validated, init as never, {
      rejectUnauthorized: true,
    }) as unknown as Awaited<ReturnType<GovernanceIngestionEgress["fetch"]>>;
  }
}

/** The AWS client factory this process already built, behind the pull's port. */
class WorkerGovernanceIngestionAws extends GovernanceIngestionAws {
  constructor(private readonly aws: AwsClientProcessRuntime) {
    super();
  }

  build(input: Parameters<GovernanceIngestionAws["build"]>[0]) {
    return this.aws.build(input) as ReturnType<GovernanceIngestionAws["build"]>;
  }
}
