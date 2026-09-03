import {
  Config,
  type ConfigValue,
  objectStorageConfigDefinition,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
} from "@langwatch/config";
import { z } from "zod";

/**
 * Only the leaves a task might need: a database, a ClickHouse endpoint, a
 * Redis endpoint, and object storage. Each is optional — this process serves
 * no traffic and owns no schema of its own, so a leaf left unset means the
 * matching {@link TaskHostPort} handle is composed absent, not that the
 * process refuses to boot. A task that actually needs the handle finds out
 * by name, at the moment it asks for it (`requirePrisma()`, ...), not at
 * boot.
 *
 * `storage` is the shared `objectStorageConfigDefinition` block, the same one
 * `apps/api` and `apps/worker` bind — so `S3_BUCKET_NAME`, `STORED_OBJECTS_BACKEND`
 * etc. mean the same thing here. `TasksHost.objectStorage`
 * (`platform/infrastructure/tasks-stored-object-storage.adapter.ts`) is S3 +
 * local-filesystem only; the `azure` leaves are read but unused today — see
 * that file's Azure named-absence note.
 */
export const tasksConfigDefinition = RuntimeConfig.define({
  databaseUrl: Config.value(z.string().min(1).optional(), { env: "DATABASE_URL" }),
  clickhouseUrl: Config.value(z.string().min(1).optional(), { env: "CLICKHOUSE_URL" }),
  redisUrl: Config.value(z.string().min(1).optional(), { env: "REDIS_URL" }),
  storage: { ...objectStorageConfigDefinition },
  /** Consumed by `ModelProviderCredentialsMigrateTask`; absent means that
   * task refuses at run time rather than at catalogue construction. */
  credentialsSecret: Config.secret({ optional: true, env: "CREDENTIALS_SECRET" }),
  /** Comma-separated module specifiers loaded at boot; see task-modules-loader.ts. */
  taskModules: Config.value(z.string().optional(), { env: "LANGWATCH_TASK_MODULES" }),
  nodeEnvironment: runtimeIdentityConfigDefinition.nodeEnvironment,
});

export type TasksConfig = ConfigValue<typeof tasksConfigDefinition>;

export function resolveTasksConfig(
  source: Readonly<Record<string, unknown>>,
): RuntimeConfig<TasksConfig> {
  return RuntimeConfig.create({ name: "tasks", definition: tasksConfigDefinition, source });
}
