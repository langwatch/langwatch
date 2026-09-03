import { LwqlProvisionTask } from "@langwatch/analytics-server";
import { SlackAlertTask } from "@langwatch/automation-server";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-client";
import { WebhookSignatureVectorsTask } from "@langwatch/egress";
import {
  ModelProviderCredentialsMigrateTask,
  ModelProviderCustomModelsMigrateTask,
  modelProviderCredentialCipherFromEnv,
} from "@langwatch/model-provider-server";
import type { Task } from "@langwatch/task";
import { buildObjectStorageMigrateTask } from "./platform/object-storage-migrate.composition";
import { PrismaMigrateTask } from "./tasks/prisma-migrate.task";
import type { TasksHost } from "./platform/tasks-host.composition";

/**
 * The one list this process's tasks live in: a feature's task is here or it
 * does not exist as far as `apps/tasks` is concerned. Most tasks take no
 * constructor arguments; the ones composed over infrastructure take the
 * process's `TasksHost` and reach for what they need through
 * `require<Handle>()`.
 *
 * Four tasks named in `dev/docs/plans/tasks-launch-interface-and-saas.md`
 * exist as `Task` subclasses but are not registered here — each names its
 * own `apps/tasks` blocker in its file, and the plan's Part 1 section
 * records the reasoning:
 *
 *   - `annotation-clickhouse-backfill` (annotation) — needs a queue write for
 *     `bulkSyncAnnotations` on the trace pipeline; `apps/tasks` composes no
 *     Eventing producer.
 *   - `dataset-content-backfill` (dataset) — needs `DatasetStorageResolver`,
 *     built from the worker's stored-object runtime; `apps/tasks` composes
 *     none (`TasksHost.objectStorage` is `never`).
 *   - `stalled-runs-backfill` (scenario) — needs the real
 *     `ScenarioExecutionService`, which dispatches through the same
 *     Eventing producer the annotation backfill is blocked on.
 *   - `topic-clustering-run` (topic) — needs `TopicClusteringCommandsPort`
 *     and `TraceTopicAssignmentPort`, both dispatched through the same
 *     Eventing producer.
 */
export function buildTasksCatalogue({ host }: { host: TasksHost }): readonly Task[] {
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
  ];
}
