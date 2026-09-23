import { ClickHouseSchemaLock, parseRoutingTable } from "@langwatch/clickhouse-client";
import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import { GOOSE_INHERITED_VARIABLES, runMigrations } from "./goose.migration-runner.ts";
import { HOT_DAYS_VARIABLES, reconcileTTL } from "./ttl.reconciler.ts";

const logger = createLogger("langwatch:task:clickhouse-migrate");

export type ClickHouseMigrationEndpoint = {
  organizationId?: string;
  url: string;
};

export type ClickHouseMigrationTaskConfig = {
  buildTime: boolean;
  /**
   * The operator's own opt-out, `SKIP_CLICKHOUSE_MIGRATE=true` — exactly
   * that string, since a half-recognised value silently skipping schema
   * work is the expensive direction: the process serves whatever schema was there.
   */
  skipped: boolean;
  sharedUrl?: string;
  privateEndpoints: readonly ClickHouseMigrationEndpoint[];
  settings?: ClickHouseMigrationSettings;
};

/** What every endpoint is migrated with, parsed from the task's input once. */
export type ClickHouseMigrationSettings = {
  clusterName?: string;
  coldStorageEnabled: boolean;
  hotDayOverrides: Readonly<Record<string, string | undefined>>;
  childEnvironment: Readonly<Record<string, string | undefined>>;
};

const NO_SETTINGS: ClickHouseMigrationSettings = {
  coldStorageEnabled: false,
  hotDayOverrides: {},
  childEnvironment: {},
};

/** Explicit task-local adapter over goose and TTL reconciliation. */
export class GooseClickHouseMigrationExecutor {
  async migrate({
    url,
    settings,
  }: {
    url: string;
    settings: ClickHouseMigrationSettings;
  }): Promise<void> {
    const { clusterName, coldStorageEnabled, hotDayOverrides, childEnvironment } = settings;
    await runMigrations({ connectionUrl: url, clusterName, childEnvironment, verbose: true });
    await reconcileTTL({
      connectionUrl: url,
      clusterName,
      coldStorageEnabled,
      hotDayOverrides,
      verbose: true,
    });
  }
}

/**
 * Task-launcher entry for ClickHouse schema migration.
 * Config is resolved at catalogue construction time, not in run().
 */
export class ClickHouseMigrateTask extends Task {
  readonly name = "clickhouse-migrate";
  readonly description = "Applies ClickHouse schema migrations and reconciles table TTLs.";

  private constructor(
    private readonly config: ClickHouseMigrationTaskConfig,
    private readonly executor: GooseClickHouseMigrationExecutor,
    private readonly lock: ClickHouseSchemaLock,
  ) {
    super();
  }

  static create({
    source,
    executor = new GooseClickHouseMigrationExecutor(),
    lock = ClickHouseSchemaLock.create(),
  }: {
    source: Record<string, string | undefined>;
    executor?: GooseClickHouseMigrationExecutor;
    /** The schema mutex this run takes. Constructed here to make the file
     * it contends for a task decision, not a shared client one. */
    lock?: ClickHouseSchemaLock;
  }): ClickHouseMigrateTask {
    return new ClickHouseMigrateTask(resolveClickHouseMigrationTaskConfig(source), executor, lock);
  }

  /** Test seam: construct directly from an already-resolved config. */
  static createFromConfig({
    config,
    executor = new GooseClickHouseMigrationExecutor(),
    lock = ClickHouseSchemaLock.create(),
  }: {
    config: ClickHouseMigrationTaskConfig;
    executor?: GooseClickHouseMigrationExecutor;
    lock?: ClickHouseSchemaLock;
  }): ClickHouseMigrateTask {
    return new ClickHouseMigrateTask(config, executor, lock);
  }

  async run(_input: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await this.execute();
  }

  async execute(): Promise<void> {
    if (this.config.skipped) {
      logger.info("Skipping ClickHouse migrations");
      return;
    }
    if (this.config.buildTime) return;

    // One process at a time owns the schema. Migration is not tenant-scoped —
    // it drops views and re-derives tables for every tenant at once — so a
    // second migrator overlapping this one reads and writes a schema partway
    // through being rebuilt, which surfaces as a wrong number rather than an
    // error and repairs itself moments later.
    const release = await this.lock.acquire();
    try {
      const migratedUrls = new Set<string>();
      if (this.config.sharedUrl !== undefined) {
        await this.migrateEndpoint({ url: this.config.sharedUrl }, migratedUrls);
      }
      for (const endpoint of this.config.privateEndpoints) {
        await this.migrateEndpoint(endpoint, migratedUrls);
      }
    } finally {
      release();
    }
  }

  private async migrateEndpoint(
    endpoint: ClickHouseMigrationEndpoint,
    migratedUrls: Set<string>,
  ): Promise<void> {
    if (migratedUrls.has(endpoint.url)) {
      if (endpoint.organizationId !== undefined) {
        logger.info(
          { orgId: endpoint.organizationId },
          "Skipping private ClickHouse migration for an aliased endpoint",
        );
      }
      return;
    }
    migratedUrls.add(endpoint.url);

    if (endpoint.organizationId !== undefined) {
      logger.info(
        { orgId: endpoint.organizationId },
        "Running migrations on private ClickHouse instance",
      );
    }
    try {
      await this.executor.migrate({
        url: endpoint.url,
        settings: this.config.settings ?? NO_SETTINGS,
      });
    } catch (error) {
      if (endpoint.organizationId !== undefined) {
        logger.error(
          {
            orgId: endpoint.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to run migrations on private ClickHouse instance",
        );
      }
      throw error;
    }
  }
}

/**
 * Parses task-owned endpoint input, using parseRoutingTable to reach
 * exactly the endpoints this process would route a tenant to.
 */
export function resolveClickHouseMigrationTaskConfig(
  source: Record<string, string | undefined>,
): ClickHouseMigrationTaskConfig {
  const table = parseRoutingTable(source);
  for (const skipped of table.skipped) {
    logger.warn(
      { envVar: skipped.envVar, reason: skipped.reason },
      "Ignoring a malformed ClickHouse route variable",
    );
  }
  for (const guess of table.ambiguous) {
    logger.warn(
      { envVar: guess.envVar, organizationId: guess.organizationId },
      "A ClickHouse route variable was split by guess; rename it if that is not the intent",
    );
  }
  const privateEndpoints: ClickHouseMigrationEndpoint[] = [...table.routes].map(
    ([organizationId, url]) => ({ organizationId, url }),
  );
  return {
    buildTime: source.BUILD_TIME !== undefined,
    skipped: source.SKIP_CLICKHOUSE_MIGRATE === "true",
    ...(source.CLICKHOUSE_URL === undefined ? {} : { sharedUrl: source.CLICKHOUSE_URL }),
    privateEndpoints,
    settings: {
      ...(source.CLICKHOUSE_CLUSTER ? { clusterName: source.CLICKHOUSE_CLUSTER } : {}),
      coldStorageEnabled: source.CLICKHOUSE_COLD_STORAGE_ENABLED === "true",
      hotDayOverrides: pickDefined(source, HOT_DAYS_VARIABLES),
      childEnvironment: pickDefined(source, GOOSE_INHERITED_VARIABLES),
    },
  };
}

function pickDefined(
  source: Record<string, string | undefined>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(
    names.flatMap((name) => (source[name] === undefined ? [] : [[name, source[name]]])),
  );
}
