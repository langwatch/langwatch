import { AgentAuditLogIdsBackfillTask } from "@langwatch/agent-server";
import { LwqlProvisionTask } from "@langwatch/analytics-server";
import { SlackAlertTask } from "@langwatch/automation-server";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-client";
import { WebhookSignatureVectorsTask } from "@langwatch/egress";
import {
  TraceDestinationReportTask,
  PostgresGatewayTraceDestinationReportAdapter,
  VirtualKeyConfigBackfillTask,
  PostgresGatewayVirtualKeyConfigBackfillAdapter,
} from "@langwatch/gateway-server";
import { GroupQueueReapStrandedGroupsTask } from "@langwatch/group-queue/operational";
import {
  DuplicateSubscriptionsReportTask,
  PostgresDuplicateSubscriptionsReportAdapter,
  StripePricesSyncTask,
  TieredFreeToSeatEventMigrateTask,
} from "@langwatch/enterprise-billing-server";
import {
  ModelProviderCredentialsMigrateTask,
  ModelProviderCustomModelsMigrateTask,
  ModelRegistrySyncTask,
} from "@langwatch/model-provider-server";
import {
  PostgresProcessManagerPurgeAdapter,
  ProcessManagerPurgeTask,
} from "@langwatch/ops-server";
import type { Task } from "@langwatch/task";
import { UserDataEraseTask } from "@langwatch/user-server";
import { buildAnnotationClickHouseBackfillTask } from "./platform/annotation-clickhouse-backfill.composition";
import { buildDatasetContentBackfillTask } from "./platform/dataset-content-backfill.composition";
import { buildObjectStorageMigrateTask } from "./platform/object-storage-migrate.composition";
import { buildStalledRunsBackfillTask } from "./platform/stalled-runs-backfill.composition";
import { buildSystemMigrationsPassTask } from "./platform/system-migrations.composition";
import type { TasksEventingInfrastructure } from "./platform/tasks-eventing.composition";
import { modelProviderCredentialCipherFromEnv } from "./platform/model-provider-credential-cipher.composition";
import { PrismaMigrateTask } from "./tasks/prisma-migrate.task";
import type { TasksHost } from "./platform/tasks-host.composition";

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
    PrismaMigrateTask.create(),
    WebhookSignatureVectorsTask.create(),
    ClickHouseMigrateTask.create({ source: process.env }),
    LwqlProvisionTask.create({
      database: () => host.requirePrisma(),
      source: process.env,
      skipped: process.env.SKIP_LWQL_PROVISION === "true",
    }),
    ModelProviderCustomModelsMigrateTask.create({ database: () => host.requirePrisma() }),
    ModelProviderCredentialsMigrateTask.create({
      database: () => host.requirePrisma(),
      cipher: () => modelProviderCredentialCipherFromEnv({ key: host.config.credentialsSecret }),
    }),
    SlackAlertTask.create({ baseHost: process.env.BASE_HOST ?? "" }),
    buildObjectStorageMigrateTask({ host }),
    buildStalledRunsBackfillTask({ host, eventing }),
    buildAnnotationClickHouseBackfillTask({ host, eventing }),
    buildDatasetContentBackfillTask({ host }),
    buildSystemMigrationsPassTask({ host, eventing }),
    ProcessManagerPurgeTask.create({
      repository: () =>
        PostgresProcessManagerPurgeAdapter.create({ database: host.requirePrisma() }),
    }),
    AgentAuditLogIdsBackfillTask.create({ database: () => host.requirePrisma() }),
    DuplicateSubscriptionsReportTask.create({
      repository: () =>
        PostgresDuplicateSubscriptionsReportAdapter.create({ database: host.requirePrisma() }),
    }),
    VirtualKeyConfigBackfillTask.create({
      repository: () =>
        PostgresGatewayVirtualKeyConfigBackfillAdapter.create({ database: host.requirePrisma() }),
    }),
    TraceDestinationReportTask.create({
      repository: () =>
        PostgresGatewayTraceDestinationReportAdapter.create({ database: host.requirePrisma() }),
    }),
    GroupQueueReapStrandedGroupsTask.create({ redis: () => host.requireRedis() }),
    StripePricesSyncTask.create({ secretKey: () => process.env.STRIPE_SECRET_KEY }),
    TieredFreeToSeatEventMigrateTask.create({ database: () => host.requirePrisma() }),
    UserDataEraseTask.create({ database: () => host.requirePrisma() }),
    ModelRegistrySyncTask.create({ apiKey: () => process.env.OPENROUTER_API_KEY }),
  ];
}
