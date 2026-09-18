import {
  Config,
  type ConfigValue,
  environmentOneOrTrueSchema,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
} from "@langwatch/config";
import { z } from "zod";

export const tasksConfigDefinition = RuntimeConfig.define({
  databaseUrl: Config.value(z.string().min(1).optional(), { env: "DATABASE_URL" }),
  redisUrl: Config.value(z.string().min(1).optional(), { env: "REDIS_URL" }),
  isSaaS: Config.value(environmentOneOrTrueSchema, { env: "IS_SAAS" }),
  skipPrismaMigrate: Config.value(environmentOneOrTrueSchema, { env: "SKIP_PRISMA_MIGRATE" }),
  skipLwqlProvision: Config.value(environmentOneOrTrueSchema, { env: "SKIP_LWQL_PROVISION" }),
  nodeEnvironment: runtimeIdentityConfigDefinition.nodeEnvironment,
});

export type TasksConfig = ConfigValue<typeof tasksConfigDefinition>;

export function resolveTasksConfig(source: Readonly<Record<string, unknown>>) {
  return RuntimeConfig.create({ name: "tasks", definition: tasksConfigDefinition, source }).value;
}

export function resolveTasksEnvironment(source: Readonly<Record<string, unknown>>) {
  return z.record(z.string(), z.string().optional()).parse(source);
}

export interface TaskInput {
  config: TasksConfig;
  environment: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
}
