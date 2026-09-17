import {
  Config,
  type ConfigValue,
  environmentOneOrTrueSchema,
  runtimeIdentityConfigDefinition,
  RuntimeConfig,
} from "@langwatch/config";
import { billingServerConfigDefinition } from "@langwatch/enterprise-billing-contract";
import { saasServerConfigDefinition } from "@langwatch/enterprise-saas-contract";
import { secretServerConfigDefinition } from "@langwatch/secret-contract";
import { storedObjectServerConfigDefinition } from "@langwatch/stored-object-contract";
import { z } from "zod";

/**
 * Only the leaves a task might need: a database, a ClickHouse endpoint, a Redis endpoint, and
 * object storage.
 */
export const tasksConfigDefinition = RuntimeConfig.define({
  databaseUrl: Config.value(z.string().min(1).optional(), { env: "DATABASE_URL" }),
  clickhouseUrl: Config.value(z.string().min(1).optional(), { env: "CLICKHOUSE_URL" }),
  redisUrl: Config.value(z.string().min(1).optional(), { env: "REDIS_URL" }),
  storage: { ...storedObjectServerConfigDefinition },
  /** Consumed by `ModelProviderCredentialsMigrateTask`; absent means that
   * task refuses at run time rather than at catalogue construction. */
  credentialsSecret: secretServerConfigDefinition.encryptionKey,
  /**
   * Whether this is the managed cloud. The system-migration pass reads it to decide pacing:
   * cloud is paced per organization by enrollment rows, a self-hosted installation admits every
   * organization for every migration already released for self-hosting.
   */
  isSaaS: saasServerConfigDefinition.isSaas,
  /** Comma-separated module specifiers loaded at boot; see task-modules-loader.ts. */
  taskModules: Config.value(z.string().optional(), { env: "LANGWATCH_TASK_MODULES" }),
  /**
   * Boot-chain and backfill switches. Each was an inline `process.env.X === "true"`
   * at its call site; stated here they are typed, listed in one place, and read
   * with the `1`/`true` spelling every other switch in the tree accepts rather
   * than the exact `"true"` they each happened to compare against.
   */
  skipPrismaMigrate: Config.value(environmentOneOrTrueSchema, { env: "SKIP_PRISMA_MIGRATE" }),
  skipLwqlProvision: Config.value(environmentOneOrTrueSchema, { env: "SKIP_LWQL_PROVISION" }),
  skipDatasetS3Migrate: Config.value(environmentOneOrTrueSchema, {
    env: "SKIP_DATASET_S3_MIGRATE",
  }),
  datasetS3MigrateDryRun: Config.value(environmentOneOrTrueSchema, {
    env: "DATASET_S3_MIGRATE_DRY_RUN",
  }),
  stalledRunsBackfillDryRun: Config.value(environmentOneOrTrueSchema, {
    env: "STALLED_RUNS_BACKFILL_DRY_RUN",
  }),
  /** The installation's public host, for links in the alerts this process sends. */
  baseHost: Config.value(z.string().optional(), { env: "BASE_HOST" }),
  /**
   * Credentials for the two sync tasks. Optional either way: absent means that
   * task refuses when it runs rather than at catalogue construction, which is
   * what lets an installation that does neither still boot.
   */
  stripeSecretKey: billingServerConfigDefinition.stripeSecretKey,
  openRouterApiKey: Config.value(z.string().optional(), { env: "OPENROUTER_API_KEY" }),
  nodeEnvironment: runtimeIdentityConfigDefinition.nodeEnvironment,
});

export type TasksConfig = ConfigValue<typeof tasksConfigDefinition>;

export function resolveTasksConfig(
  source: Readonly<Record<string, unknown>>,
): RuntimeConfig<TasksConfig> {
  return RuntimeConfig.create({ name: "tasks", definition: tasksConfigDefinition, source });
}
