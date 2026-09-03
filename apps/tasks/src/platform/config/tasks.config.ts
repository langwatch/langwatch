import { Config, type ConfigValue, RuntimeConfig } from "@langwatch/config";
import { z } from "zod";

/**
 * Only the leaves a task might need: a database, a ClickHouse endpoint, a
 * Redis endpoint, and object storage. Each is optional — this process serves
 * no traffic and owns no schema of its own, so a leaf left unset means the
 * matching {@link TaskHostPort} handle is composed absent, not that the
 * process refuses to boot. A task that actually needs the handle finds out
 * by name, at the moment it asks for it (`requirePrisma()`, ...), not at
 * boot.
 */
export const tasksConfigDefinition = RuntimeConfig.define({
  databaseUrl: Config.value(z.string().min(1).optional(), { env: "DATABASE_URL" }),
  clickhouseUrl: Config.value(z.string().min(1).optional(), { env: "CLICKHOUSE_URL" }),
  redisUrl: Config.value(z.string().min(1).optional(), { env: "REDIS_URL" }),
  objectStorageBucket: Config.value(z.string().min(1).optional(), {
    env: "STORED_OBJECTS_BUCKET",
  }),
  nodeEnvironment: Config.value(
    z.enum(["development", "test", "production"]).default("development"),
    {
      env: "NODE_ENV",
    },
  ),
});

export type TasksConfig = ConfigValue<typeof tasksConfigDefinition>;

export function resolveTasksConfig(
  source: Readonly<Record<string, unknown>>,
): RuntimeConfig<TasksConfig> {
  return RuntimeConfig.create({ name: "tasks", definition: tasksConfigDefinition, source });
}
