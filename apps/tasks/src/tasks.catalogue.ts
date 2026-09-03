import { LwqlProvisionTask } from "@langwatch/analytics-server";
import { SlackAlertTask } from "@langwatch/automation-server";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-client";
import { WebhookSignatureVectorsTask } from "@langwatch/egress";
import {
  StripePricesSyncTask,
  TieredFreeToSeatEventMigrateTask,
} from "@langwatch/enterprise-billing-server";
import {
  ModelProviderCredentialsMigrateTask,
  ModelProviderCustomModelsMigrateTask,
  ModelRegistrySyncTask,
  modelProviderCredentialCipherFromEnv,
} from "@langwatch/model-provider-server";
import type { Task } from "@langwatch/task";
import { UserDataEraseTask } from "@langwatch/user-server";
import { buildAnnotationClickHouseBackfillTask } from "./platform/annotation-clickhouse-backfill.composition";
import { buildDatasetContentBackfillTask } from "./platform/dataset-content-backfill.composition";
import { buildObjectStorageMigrateTask } from "./platform/object-storage-migrate.composition";
import { buildStalledRunsBackfillTask } from "./platform/stalled-runs-backfill.composition";
import type { TasksEventingInfrastructure } from "./platform/tasks-eventing.composition";
import { PrismaMigrateTask } from "./tasks/prisma-migrate.task";
import type { TasksHost } from "./platform/tasks-host.composition";

/**
 * The one list this process's tasks live in: a feature's task is here or it
 * does not exist as far as `apps/tasks` is concerned, composed over
 * `TasksHost` and, for Eventing dispatch, `TasksEventingInfrastructure`.
 * One `Task` subclass — `topic-clustering-run` — stays unregistered, naming
 * its own blocker in its file; full reasoning:
 * `dev/docs/plans/tasks-launch-interface-and-saas.md`.
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
    LwqlProvisionTask.create({ database: () => host.requirePrisma() }),
    ModelProviderCustomModelsMigrateTask.create({ database: () => host.requirePrisma() }),
    ModelProviderCredentialsMigrateTask.create({
      database: () => host.requirePrisma(),
      cipher: () => modelProviderCredentialCipherFromEnv({ key: host.config.credentialsSecret }),
    }),
    SlackAlertTask.create(),
    buildObjectStorageMigrateTask({ host }),
    buildStalledRunsBackfillTask({ host, eventing }),
    buildAnnotationClickHouseBackfillTask({ host, eventing }),
    buildDatasetContentBackfillTask({ host }),
    StripePricesSyncTask.create({ secretKey: () => process.env.STRIPE_SECRET_KEY }),
    TieredFreeToSeatEventMigrateTask.create({ database: () => host.requirePrisma() }),
    UserDataEraseTask.create({ database: () => host.requirePrisma() }),
    ModelRegistrySyncTask.create({ apiKey: () => process.env.OPENROUTER_API_KEY }),
  ];
}
