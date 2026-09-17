import { LwqlProvisionTask } from "@langwatch/analytics-server";
import { SlackAlertTask } from "@langwatch/automation-server";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { WebhookSignatureVectorsTask } from "@langwatch/egress";
import {
  DuplicateSubscriptionsReportTask,
  PostgresBillingRepositories,
  StripePricesSyncTask,
  TieredFreeToSeatEventMigrateTask,
} from "@langwatch/enterprise-billing-server";
import {
  TraceDestinationReportTask,
  PrismaGatewayTraceDestinationReportRepository,
  VirtualKeyConfigBackfillTask,
  PrismaGatewayVirtualKeyConfigBackfillRepository,
} from "@langwatch/gateway-server";
import { GroupQueueReapStrandedGroupsTask } from "@langwatch/group-queue/operational";
import {
  ModelProviderCredentialsMigrateTask,
  ModelProviderCustomModelsMigrateTask,
  ModelRegistrySyncTask,
} from "@langwatch/model-provider-server";
import {
  PrismaProcessManagerPurgeRepository,
  ProcessManagerPurgeTask,
} from "@langwatch/ops-server";
import type { Task } from "@langwatch/task";
import { createGdprUserDataEraseRunner } from "@langwatch/user-server";

import { buildDatasetContentBackfillTask } from "./platform/dataset-content-backfill.composition.ts";
import { modelProviderCredentialCipherFromEnv } from "./platform/model-provider-credential-cipher.composition.ts";
import { buildObjectStorageMigrateTask } from "./platform/object-storage-migrate.composition.ts";
import { buildStalledRunsBackfillTask } from "./platform/stalled-runs-backfill.composition.ts";
import { buildSystemMigrationsPassTask } from "./platform/system-migrations.composition.ts";
import type { TasksEventingInfrastructure } from "./platform/tasks-eventing.composition.ts";
import type { TasksHost } from "./platform/tasks-host.composition.ts";
import { AgentAuditLogIdsBackfillTask } from "./tasks/agent-audit-log-ids-backfill.task.ts";
import { PrismaMigrateTask } from "./tasks/prisma-migrate.task.ts";

/**
 * The one list this process's tasks live in: a feature's task is here or it does not exist as
 * far as `apps/tasks` is concerned, composed over `TasksHost` and, for Eventing dispatch,
 * `TasksEventingInfrastructure`.
 */
export function buildTasksCatalogue({
  host,
  eventing,
}: {
  host: TasksHost;
  eventing: TasksEventingInfrastructure | undefined;
}): readonly Task[] {
  return [
    PrismaMigrateTask.create({
      skipped: host.config.skipPrismaMigrate,
      environment: host.environment,
    }),
    WebhookSignatureVectorsTask.create(),
    ClickHouseMigrateTask.create({ source: host.environment }),
    LwqlProvisionTask.create({
      database: () => host.requirePrisma(),
      source: host.environment,
      skipped: host.config.skipLwqlProvision,
    }),
    ModelProviderCustomModelsMigrateTask.create({ database: () => host.requirePrisma() }),
    ModelProviderCredentialsMigrateTask.create({
      database: () => host.requirePrisma(),
      cipher: () => modelProviderCredentialCipherFromEnv({ key: host.config.credentialsSecret }),
    }),
    SlackAlertTask.create({ baseHost: host.config.baseHost ?? "" }),
    buildObjectStorageMigrateTask({ host }),
    buildStalledRunsBackfillTask({ host, eventing }),
    buildDatasetContentBackfillTask({ host }),
    buildSystemMigrationsPassTask({ host, eventing }),
    ProcessManagerPurgeTask.create({
      repository: () =>
        PrismaProcessManagerPurgeRepository.create({ database: host.requirePrisma() }),
    }),
    AgentAuditLogIdsBackfillTask.create({
      database: () => host.requirePrisma(),
      redis: host.redis ?? null,
    }),
    DuplicateSubscriptionsReportTask.create({
      repository: () =>
        PostgresBillingRepositories.create({ prisma: host.requirePrisma() })
          .duplicateSubscriptionsReports,
    }),
    VirtualKeyConfigBackfillTask.create({
      repository: () =>
        PrismaGatewayVirtualKeyConfigBackfillRepository.create({ database: host.requirePrisma() }),
    }),
    TraceDestinationReportTask.create({
      repository: () =>
        PrismaGatewayTraceDestinationReportRepository.create({ database: host.requirePrisma() }),
    }),
    GroupQueueReapStrandedGroupsTask.create({ redis: () => host.requireRedis() }),
    StripePricesSyncTask.create({ secretKey: () => host.config.stripeSecretKey }),
    TieredFreeToSeatEventMigrateTask.create({ database: () => host.requirePrisma() }),
    createGdprUserDataEraseRunner({ database: host.requirePrisma() }),
    ModelRegistrySyncTask.create({ apiKey: () => host.config.openRouterApiKey }),
  ];
}
