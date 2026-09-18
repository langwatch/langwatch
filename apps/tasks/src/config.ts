import {
  Config,
  environmentOneOrTrueSchema,
  nodeEnvironmentSchema,
  parseProcessConfig,
  type ConfigOf,
} from "@langwatch/config";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { RedisConnection } from "@langwatch/redis-client";
import { Secret } from "@langwatch/secrets";
import { z } from "zod";

/** The migration runner's own controls. Connection strings are not among them. */
export const tasksConfig = Config.define((c) => ({
  isSaaS: c.env("IS_SAAS", environmentOneOrTrueSchema),
  skipPrismaMigrate: c.env("SKIP_PRISMA_MIGRATE", environmentOneOrTrueSchema),
  skipLwqlProvision: c.env("SKIP_LWQL_PROVISION", environmentOneOrTrueSchema),
  nodeEnvironment: c.env("NODE_ENV", nodeEnvironmentSchema),
}));

export type TasksConfig = ConfigOf<typeof tasksConfig>;

/**
 * The two connections this runner opens. Declared here beside the config so
 * one file states everything the deployment supplies; resolved at the boot
 * seam and never handed to a task as a string.
 */
export const tasksSecrets = {
  databaseUrl: Secret.load("DATABASE_URL", { optional: true }),
  redisUrl: Secret.load("REDIS_URL", { optional: true }),
} as const;

export function resolveTasksConfig(source: Readonly<Record<string, unknown>>): TasksConfig {
  return parseProcessConfig({
    owners: [{ name: "tasks", config: tasksConfig }],
    environment: resolveTasksEnvironment(source),
  }).tasks;
}

export function resolveTasksEnvironment(
  source: Readonly<Record<string, unknown>>,
): Readonly<Record<string, string | undefined>> {
  return z.record(z.string(), z.string().optional()).parse(source);
}

/**
 * The opened migration database, holding the advisory lock over itself: both
 * come from the one URL, so one object owns both and nothing remembers it.
 */
export interface TasksDatabase {
  readonly client: PrismaClient;
  /** Runs the sequence under this database's advisory lock. */
  hold(run: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/**
 * A connection string is a credential: spent at the construction site inside
 * `secrets.into(...)` and never carried past it. These are what came back —
 * connections, already open. `null` means the deployment named none.
 */
export interface TaskConnections {
  readonly database: TasksDatabase | null;
  readonly redis: RedisConnection | null;
}

export interface TaskInput {
  config: TasksConfig;
  connections: TaskConnections;
  environment: Readonly<Record<string, string | undefined>>;
  signal: AbortSignal;
}
