import {
  Config,
  type ConfigValue,
  environmentOneOrTrueSchema,
  objectStorageConfigDefinition,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
} from "@langwatch/config";
import { z } from "zod";

/**
 * Only the leaves a task might need: a database, a ClickHouse endpoint, a Redis endpoint, and
 * object storage.
 */
export const tasksConfigDefinition = RuntimeConfig.define({
  databaseUrl: Config.value(z.string().min(1).optional(), { env: "DATABASE_URL" }),
  clickhouseUrl: Config.value(z.string().min(1).optional(), { env: "CLICKHOUSE_URL" }),
  redisUrl: Config.value(z.string().min(1).optional(), { env: "REDIS_URL" }),
  storage: { ...objectStorageConfigDefinition },
  /** Consumed by `ModelProviderCredentialsMigrateTask`; absent means that
   * task refuses at run time rather than at catalogue construction. */
  credentialsSecret: Config.secret({ optional: true, env: "CREDENTIALS_SECRET" }),
  /**
   * Whether this is the managed cloud. The system-migration pass reads it to decide pacing:
   * cloud is paced per organization by enrollment rows, a self-hosted installation admits every
   * organization for every migration already released for self-hosting.
   */
  isSaaS: Config.value(environmentOneOrTrueSchema, { env: "IS_SAAS" }),
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
